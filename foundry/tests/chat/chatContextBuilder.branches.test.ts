import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run } from "../../src/domain/types.js";
import type { Artifact } from "../../src/domain/types.js";

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

describe("buildChatSystemPrompt — additional branch coverage", () => {
  it("includes the Plan's open questions section when the Plan artifact has openQuestions", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        steps: [],
        openQuestions: [{ id: "q1", question: "Should we cache?", requiredForExecution: true }],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);

    expect(result).toContain("## Current Plan");
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Should we cache?");
  });

  it("includes the Plan Review Findings section when a PlanReview artifact is present", () => {
    const planReviewArtifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "The plan looks mostly solid.",
        findings: [
          {
            id: "f1",
            severity: "important",
            title: "Missing rollback",
            details: "No rollback plan for the migration.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [planReviewArtifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("The plan looks mostly solid.");
    expect(result).toContain("**[important] Missing rollback** (f1): No rollback plan for the migration.");
  });

  it("omits the Plan Review Findings section when no PlanReview artifact is present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes the Code Review Findings section when a Review artifact is present", () => {
    const reviewArtifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One blocker found.",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            title: "Null pointer risk",
            details: "foo can be null here.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [reviewArtifact]);

    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("One blocker found.");
    expect(result).toContain("**[blocker] Null pointer risk** (f1): foo can be null here.");
  });

  it("omits the Code Review Findings section when no Review artifact is present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
  });
});
