import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run, Artifact } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Implement the feature",
    linearIssueTitle: "Feature XYZ",
    linearIssueUrl: "https://linear.app/test/issue/ENG-42",
    repo: "test/repo",
    branchName: "feature/xyz",
    prNumber: 99,
    state: "Implementing",
    planVersion: 2,
    approvedPlanVersion: 2,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/workspace/repo",
    latestArtifactVersion: 5,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> & { type: string }): Artifact {
  return {
    id: `artifact-${Math.random()}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: new Date("2024-01-01"),
    ...overrides,
  } as Artifact;
}

describe("buildChatSystemPrompt - Plan Review Findings section", () => {
  it("omits the section entirely when no PlanReview artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes the summary and each finding when a PlanReview artifact is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan mostly sound, one gap found.",
        findings: [
          {
            id: "pf1",
            severity: "important",
            title: "Missing error handling",
            details: "No plan step covers malformed input.",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Plan mostly sound, one gap found.");
    expect(result).toContain("[important] Missing error handling");
    expect(result).toContain("(pf1)");
    expect(result).toContain("No plan step covers malformed input.");
  });

  it("uses the highest-versioned PlanReview artifact when multiple exist", () => {
    const v1 = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "Old plan review", findings: [] },
    });
    const v2 = makeArtifact({
      type: "PlanReview",
      version: 2,
      payloadJson: { summary: "New plan review", findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [v1, v2]);
    expect(result).toContain("New plan review");
    expect(result).not.toContain("Old plan review");
  });

  it("omits the section when the PlanReview artifact has neither summary nor findings", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("renders the summary line alone when findings is an empty array", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "All good, nothing to flag.", findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("All good, nothing to flag.");
  });
});

describe("buildChatSystemPrompt - Plan open questions", () => {
  it("includes open questions in the Current Plan section, stringifying non-string entries", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: [
          "Should we strip unknown fields?",
          { id: "q2", question: "Structured question object" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Should we strip unknown fields?");
    expect(result).toContain('"question":"Structured question object"');
  });

  it("omits the Open Questions heading when openQuestions is an empty array", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Plan summary", openQuestions: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("**Open Questions:**");
  });
});

describe("buildChatSystemPrompt - Code Review Findings section", () => {
  it("omits the section entirely when no Review artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("includes the summary and each finding when a Review artifact is present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One blocker found.",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            title: "Null pointer risk",
            details: "req.body may be undefined.",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("One blocker found.");
    expect(result).toContain("[blocker] Null pointer risk");
    expect(result).toContain("(f1)");
    expect(result).toContain("req.body may be undefined.");
  });

  it("uses the highest-versioned Review artifact when multiple exist", () => {
    const v1 = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "Old review", findings: [] },
    });
    const v2 = makeArtifact({
      type: "Review",
      version: 3,
      payloadJson: { summary: "Latest review", findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [v1, v2]);
    expect(result).toContain("Latest review");
    expect(result).not.toContain("Old review");
  });

  it("omits the section when the Review artifact has neither summary nor findings", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("renders multiple findings, each on its own line", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Two findings.",
        findings: [
          { id: "f1", severity: "important", title: "Issue one", details: "Detail one" },
          { id: "f2", severity: "nit", title: "Issue two", details: "Detail two" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("[important] Issue one");
    expect(result).toContain("[nit] Issue two");
  });
});
