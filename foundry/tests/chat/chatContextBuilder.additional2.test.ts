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

describe("buildChatSystemPrompt - Run Metadata branch coverage", () => {
  it("renders '(none)' for branchName and prNumber when both are null", () => {
    const result = buildChatSystemPrompt(makeRun({ branchName: null, prNumber: null }), []);
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });

  it("renders the actual branchName and prNumber when both are set", () => {
    const result = buildChatSystemPrompt(makeRun({ branchName: "feature/x", prNumber: 7 }), []);
    expect(result).toContain("**Branch:** feature/x");
    expect(result).toContain("**PR Number:** 7");
  });
});

describe("buildChatSystemPrompt - Linear Issue section branches", () => {
  it("omits the Linear Issue section when title, identifier, and description are all absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueDescription: null }),
      [],
    );
    expect(result).not.toContain("## Linear Issue");
  });

  it("includes only the identifier line when title and description are absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-9", linearIssueDescription: null }),
      [],
    );
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-9");
    expect(result).not.toContain("**Title:**");
    expect(result).not.toContain("**Description:**");
  });

  it("includes only the description line when title and identifier are absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueDescription: "Just a description" }),
      [],
    );
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Description:**\nJust a description");
    expect(result).not.toContain("**Identifier:**");
    expect(result).not.toContain("**Title:**");
  });
});

describe("buildChatSystemPrompt - Current Plan step/risk/assumption field fallbacks", () => {
  it("falls back to empty strings for a step missing id/title/description", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "S", steps: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("  - **** : ");
  });

  it("JSON-stringifies non-string risk and assumption entries", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "S",
        risks: [{ severity: "high", text: "structured risk" }],
        assumptions: [{ note: "structured assumption" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain('"severity":"high"');
    expect(result).toContain('"note":"structured assumption"');
  });
});

describe("buildChatSystemPrompt - Human Answers field fallbacks", () => {
  it("falls back to empty strings when questionId/answer are missing", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("  - **[]:** ");
  });
});

describe("buildChatSystemPrompt - Researched Answers summary fallback", () => {
  it("omits the leading summary line when the ResearchedAnswers payload has no summary", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: {
        answers: [{ questionId: "q1", question: "Q?", answer: "A.", confidence: "low" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers (AI best-effort, not authoritative)");
    expect(result).not.toContain("**Summary:**");
  });
});

describe("buildChatSystemPrompt - Researched Answers per-entry field fallbacks", () => {
  it("falls back to empty strings for questionId/confidence/answer when missing on an entry", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: { summary: "S", answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("  - **[] ():** ");
  });
});

describe("buildChatSystemPrompt - Plan Review Findings per-entry field fallbacks", () => {
  it("falls back to empty strings when a PlanReview finding's severity/title/id/details are missing", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "One gap.", findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("  - **[] ** (): ");
  });
});

describe("buildChatSystemPrompt - Execution Report field fallbacks", () => {
  it("falls back to '?' status and omits the em-dash detail when a check's status/details are missing", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        score: 0.5,
        checks: { lint: {}, typecheck: { status: "pass" }, tests: { status: "fail", details: "flake" } },
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Lint:** ?");
    expect(result).toContain("**Typecheck:** pass");
    expect(result).not.toContain("**Typecheck:** pass —");
    expect(result).toContain("**Tests:** fail — flake");
  });

  it("stringifies non-string filesChanged and notes entries", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        score: 0.5,
        filesChanged: [{ path: "src/x.ts", renamed: true }],
        notes: [{ kind: "warning", text: "careful here" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain('"path":"src/x.ts"');
    expect(result).toContain('"kind":"warning"');
  });

  it("falls back to the artifact's own version when executionVersion is absent from the payload", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 4,
      payloadJson: { score: 0.5 },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v4)");
  });

  it("uses the payload's own executionVersion over the artifact's version when both are present", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 4,
      payloadJson: { score: 0.5, executionVersion: 7 },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v7)");
  });
});

describe("buildChatSystemPrompt - Code Review Findings field fallbacks", () => {
  it("falls back to empty strings when a finding's severity/title/id/details are missing", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "One finding.", findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("  - **[] ** (): ");
  });
});

describe("buildChatSystemPrompt - Rejection Context field fallbacks", () => {
  it("falls back to '?' for planVersion and empty strings for source/mode/feedback when absent", () => {
    const artifact = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Rejection Context(s)");
    expect(result).toContain("  - **Plan v?** (, ): ");
  });
});

describe("buildChatSystemPrompt - findLatest reduce over 3+ same-type artifacts", () => {
  it("keeps selecting the highest version across more than two candidates, regardless of array order", () => {
    const v1 = makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "v1" } });
    const v3 = makeArtifact({ type: "Plan", version: 3, payloadJson: { summary: "v3" } });
    const v2 = makeArtifact({ type: "Plan", version: 2, payloadJson: { summary: "v2" } });
    // Order deliberately not sorted, and the eventual max isn't first or last,
    // to exercise both the true and false sides of the reduce comparison.
    const result = buildChatSystemPrompt(makeRun(), [v1, v3, v2]);
    expect(result).toContain("v3");
    expect(result).not.toContain("v1");
    expect(result).not.toContain("v2");
  });
});
