import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run, Artifact } from "../../src/domain/types.js";

// Additive coverage file: targets the "## Plan Review Findings" (PlanReview
// artifact) and "## Code Review Findings" (Review artifact) sections, which
// tests/chat/chatContextBuilder.test.ts does not exercise.

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

describe("buildChatSystemPrompt - Current Plan open questions", () => {
  it("includes open questions from the latest Plan artifact", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        steps: [],
        openQuestions: [{ id: "q1", question: "Should we use camelCase?" }],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Current Plan");
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain('{"id":"q1","question":"Should we use camelCase?"}');
  });

  it("renders a plain-string open question as-is instead of JSON", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: ["Should we use camelCase?"],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("  - Should we use camelCase?");
  });

  it("omits the Open Questions line when the Plan artifact has none", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Plan summary", openQuestions: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Current Plan");
    expect(result).not.toContain("**Open Questions:**");
  });
});

describe("buildChatSystemPrompt - Plan Review Findings section", () => {
  it("includes the summary and findings when a PlanReview artifact is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "The plan mostly covers requirements.",
        findings: [
          {
            id: "pf1",
            severity: "important",
            title: "Missing error handling step",
            details: "Malformed JSON bodies are not addressed.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("The plan mostly covers requirements.");
    expect(result).toContain("[important] Missing error handling step");
    expect(result).toContain("(pf1)");
    expect(result).toContain("Malformed JSON bodies are not addressed.");
  });

  it("omits the Plan Review Findings section when no PlanReview artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("omits the section when the PlanReview artifact has no summary and no findings", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {},
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("renders the summary alone when findings is an empty array", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "No issues found.", findings: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("No issues found.");
  });

  it("falls back to empty strings for missing finding fields", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        findings: [{}],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("  - **[] ** (): ");
  });

  it("uses the highest-versioned PlanReview artifact when several exist", () => {
    const v1 = makeArtifact({ type: "PlanReview", version: 1, payloadJson: { summary: "Old" } });
    const v2 = makeArtifact({ type: "PlanReview", version: 2, payloadJson: { summary: "New" } });

    const result = buildChatSystemPrompt(makeRun(), [v1, v2]);
    expect(result).toContain("New");
    expect(result).not.toContain("Old");
  });
});

describe("buildChatSystemPrompt - Code Review Findings section", () => {
  it("includes the summary and findings when a Review artifact is present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Implementation is solid overall.",
        findings: [
          {
            id: "f1",
            severity: "important",
            title: "Missing null check",
            details: "Will throw if body is undefined.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("Implementation is solid overall.");
    expect(result).toContain("[important] Missing null check");
    expect(result).toContain("(f1)");
    expect(result).toContain("Will throw if body is undefined.");
  });

  it("omits the Code Review Findings section when no Review artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("omits the section when the Review artifact has no summary and no findings", () => {
    const artifact = makeArtifact({ type: "Review", version: 1, payloadJson: {} });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("uses the highest-versioned Review artifact when several exist", () => {
    const v1 = makeArtifact({ type: "Review", version: 1, payloadJson: { summary: "Stale" } });
    const v2 = makeArtifact({ type: "Review", version: 3, payloadJson: { summary: "Latest" } });

    const result = buildChatSystemPrompt(makeRun(), [v1, v2]);
    expect(result).toContain("Latest");
    expect(result).not.toContain("Stale");
  });

  it("renders multiple findings each on their own line", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Two findings.",
        findings: [
          { id: "f1", severity: "blocker", title: "Bug one", details: "Details one" },
          { id: "f2", severity: "nit", title: "Style nit", details: "Details two" },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("[blocker] Bug one");
    expect(result).toContain("[nit] Style nit");
  });
});
