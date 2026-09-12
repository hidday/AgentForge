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
    state: "AIReview",
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

describe("buildChatSystemPrompt - Plan openQuestions rendering", () => {
  it("renders openQuestions as bulleted lines, stringifying non-string entries", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: [
          "Should we use camelCase?",
          { id: "q2", question: "Object form question?" },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Should we use camelCase?");
    expect(result).toContain(JSON.stringify({ id: "q2", question: "Object form question?" }));
  });

  it("omits the Open Questions line when the array is empty", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Plan summary", openQuestions: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).not.toContain("**Open Questions:**");
  });
});

describe("buildChatSystemPrompt - PlanReview findings section", () => {
  it("renders the summary and each finding for a PlanReview artifact", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan mostly solid, one gap found.",
        findings: [
          {
            id: "pf1",
            severity: "important",
            title: "Missing rollback step",
            details: "No rollback plan for the migration.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Plan mostly solid, one gap found.");
    expect(result).toContain("[important] Missing rollback step");
    expect(result).toContain("(pf1)");
    expect(result).toContain("No rollback plan for the migration.");
  });

  it("omits the Plan Review Findings section when no PlanReview artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("renders only the summary line when findings is an empty array", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "All clear.", findings: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("All clear.");
  });

  it("omits the section entirely when summary is absent and findings is empty", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { findings: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).not.toContain("## Plan Review Findings");
  });

  it("falls back to empty strings for missing finding sub-fields", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        findings: [{}],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("[] ** ():");
  });
});

describe("buildChatSystemPrompt - Review (code review) findings section", () => {
  it("renders the summary and each finding for a Review artifact", () => {
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

  it("omits the Code Review Findings section when no Review artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("omits the section entirely when summary is absent and findings is empty", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).not.toContain("## Code Review Findings");
  });

  it("uses the highest-version Review artifact when multiple exist", () => {
    const older = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "Old review summary" },
    });
    const newer = makeArtifact({
      type: "Review",
      version: 2,
      payloadJson: { summary: "New review summary" },
    });

    const result = buildChatSystemPrompt(makeRun(), [older, newer]);

    expect(result).toContain("New review summary");
    expect(result).not.toContain("Old review summary");
  });
});
