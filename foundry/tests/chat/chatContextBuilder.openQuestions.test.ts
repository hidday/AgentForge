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

describe("buildChatSystemPrompt — Plan.openQuestions section (lines 69-74)", () => {
  it("renders an 'Open Questions:' heading and a bulleted line for each string question", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 3,
      payloadJson: {
        summary: "Plan with open questions",
        openQuestions: [
          "Should we strip unknown fields?",
          "Does auth run before validation?",
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);

    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("  - Should we strip unknown fields?");
    expect(result).toContain("  - Does auth run before validation?");
  });

  it("JSON-stringifies a non-string open question entry", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 3,
      payloadJson: {
        summary: "Plan with structured open questions",
        openQuestions: [
          { id: "q1", question: "Should validation strip unknown fields?", requiredForExecution: false },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);

    expect(result).toContain("**Open Questions:**");
    expect(result).toContain(
      JSON.stringify({
        id: "q1",
        question: "Should validation strip unknown fields?",
        requiredForExecution: false,
      }),
    );
  });

  it("omits the 'Open Questions:' heading entirely when openQuestions is an empty array", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan with no open questions",
        openQuestions: [],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);

    expect(result).not.toContain("**Open Questions:**");
  });

  it("omits the 'Open Questions:' heading when openQuestions is not present at all", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan with the field entirely absent",
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);

    expect(result).not.toContain("**Open Questions:**");
  });
});
