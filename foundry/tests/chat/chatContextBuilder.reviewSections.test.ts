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

describe("buildChatSystemPrompt: Current Plan open questions", () => {
  it("renders the Open Questions sub-section when the Plan artifact has open questions", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        steps: [],
        openQuestions: [{ id: "q1", question: "Use Postgres?", requiredForExecution: true }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("q1");
    expect(result).toContain("Use Postgres?");
  });
});

describe("buildChatSystemPrompt: Plan Review Findings section", () => {
  it("omits the section when no PlanReview artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("renders the summary and each finding when a PlanReview artifact is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Mostly solid, one blocker.",
        findings: [
          {
            id: "pr1",
            severity: "blocker",
            title: "Missing rollback plan",
            details: "No rollback strategy for the migration step",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Mostly solid, one blocker.");
    expect(result).toContain("[blocker] Missing rollback plan");
    expect(result).toContain("pr1");
    expect(result).toContain("No rollback strategy for the migration step");
  });

  it("omits the section when the PlanReview artifact has no summary and no findings", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("renders only the summary line when findings is empty but summary is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "All good, no findings.", findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("All good, no findings.");
  });
});

describe("buildChatSystemPrompt: Code Review Findings section", () => {
  it("omits the section when no Review artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("renders the summary and each finding when a Review artifact is present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One important issue found.",
        findings: [
          {
            id: "r1",
            severity: "important",
            title: "Race condition",
            details: "Concurrent writes can clobber state",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("One important issue found.");
    expect(result).toContain("[important] Race condition");
    expect(result).toContain("r1");
    expect(result).toContain("Concurrent writes can clobber state");
  });

  it("omits the section when the Review artifact has no summary and no findings", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("renders both Plan Review and Code Review sections together when both artifacts are present", () => {
    const planReview = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "Plan review summary", findings: [] },
    });
    const review = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "Code review summary", findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [planReview, review]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Plan review summary");
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("Code review summary");
  });
});
