import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run } from "../../src/domain/types.js";
import type { Artifact } from "../../src/domain/types.js";

// Covers the Plan's "Open Questions" rendering branch (plan.openQuestions
// non-empty) not exercised by chatContextBuilder.test.ts or
// chatContextBuilder.gaps.test.ts.

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
  } as Run;
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

describe("buildChatSystemPrompt — Current Plan Open Questions section", () => {
  it("renders each open question as a bullet, stringifying non-string entries", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Add auth middleware",
        openQuestions: [
          "Should we use JWT or sessions?",
          { id: "q2", question: "Which rate limiter library?", requiredForExecution: true },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("## Current Plan (v1)");
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("  - Should we use JWT or sessions?");
    expect(result).toContain(
      `  - ${JSON.stringify({ id: "q2", question: "Which rate limiter library?", requiredForExecution: true })}`,
    );
  });

  it("omits the Open Questions bullet list when the plan's openQuestions array is empty", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "No open questions here", openQuestions: [] },
    });

    const result = buildChatSystemPrompt(makeRun(), [artifact]);

    expect(result).toContain("**Summary:** No open questions here");
    expect(result).not.toContain("**Open Questions:**");
  });
});
