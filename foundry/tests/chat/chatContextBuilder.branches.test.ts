import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run } from "../../src/domain/types.js";
import type { Artifact } from "../../src/domain/types.js";

// Covers edge-case / fallback branches of buildChatSystemPrompt that
// chatContextBuilder.test.ts does not exercise: missing run fields, missing
// artifact sub-fields, non-string array entries, and the findLatest "keep
// current best" path.

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test/repo",
    branchName: null,
    prNumber: null,
    state: "Implementing",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/workspace/repo",
    latestArtifactVersion: 1,
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

describe("buildChatSystemPrompt edge cases", () => {
  it("falls back to '(none)' for branchName and prNumber when both are null", () => {
    const result = buildChatSystemPrompt(makeRun({ branchName: null, prNumber: null }), []);
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });

  it("renders branchName and prNumber when present", () => {
    const result = buildChatSystemPrompt(makeRun({ branchName: "feat/x", prNumber: 7 }), []);
    expect(result).toContain("**Branch:** feat/x");
    expect(result).toContain("**PR Number:** 7");
  });

  it("omits the Linear Issue section entirely when title, identifier, and description are all absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueDescription: null }),
      [],
    );
    expect(result).not.toContain("## Linear Issue");
  });

  it("includes the Linear Issue section when only the identifier is present", () => {
    const result = buildChatSystemPrompt(makeRun({ linearIssueIdentifier: "ENG-1" }), []);
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-1");
  });

  it("falls back to empty strings for missing step id/title/description", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { steps: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("## Current Plan");
    // Rendered as "  - **** : " with all three fields empty.
    expect(result).toContain("  - **** : ");
  });

  it("JSON-stringifies non-string risk, assumption, and open-question entries", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        risks: [{ severity: "high" }],
        assumptions: [{ note: "uses postgres" }],
        openQuestions: [{ id: "q1" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain('{"severity":"high"}');
    expect(result).toContain('{"note":"uses postgres"}');
    expect(result).toContain('{"id":"q1"}');
  });

  it("falls back to empty strings for missing human-answer questionId/answer", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Human Answers");
    expect(result).toContain("  - **[]:** ");
  });

  it("omits the summary line and sources when a researched answer has neither", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: {
        answers: [{ questionId: "q1", answer: "A", confidence: "low" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers");
    expect(result).not.toContain("**Summary:**");
    expect(result).not.toContain("_(sources:");
  });

  it("omits the Plan Review Findings section when the PlanReview has no summary and no findings", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes Plan Review Findings summary even with no findings array", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "Looks solid overall." },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Looks solid overall.");
  });

  it("renders checks with missing status/details using the '?' fallback and skips the details suffix", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        checks: { lint: {}, typecheck: { status: "pass" }, tests: { status: "fail", details: "flaked" } },
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Lint:** ?");
    expect(result).toContain("**Typecheck:** pass");
    expect(result).not.toContain("**Typecheck:** pass —");
    expect(result).toContain("**Tests:** fail — flaked");
  });

  it("JSON-stringifies non-string filesChanged and notes entries", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        filesChanged: [{ path: "src/foo.ts" }],
        notes: [{ note: "skipped edge case" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain('{"path":"src/foo.ts"}');
    expect(result).toContain('{"note":"skipped edge case"}');
  });

  it("omits the PR Draft Created line when prDraftCreated is not a boolean", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: { summary: "done" },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("**PR Draft Created:**");
  });

  it("omits the Code Review Findings section when the Review has no summary and no findings", () => {
    const artifact = makeArtifact({ type: "Review", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("includes Code Review Findings with findings that have missing fields", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("  - **[] ** (): ");
  });

  it("falls back to '?' and empty strings for missing rejection-context fields", () => {
    const artifact = makeArtifact({ type: "RejectionContext", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Rejection Context(s)");
    expect(result).toContain("**Plan v?** (, ): ");
  });

  it("keeps the earlier artifact as 'best' when a later same-type artifact has a lower version", () => {
    const planV3 = makeArtifact({ type: "Plan", version: 3, payloadJson: { summary: "Newest" } });
    const planV1 = makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "Oldest" } });
    // planV3 appears first in the array; the reduce comparison for planV1 (cur.version=1
    // > best.version=3) is false, exercising the "keep best" branch of findLatest.
    const result = buildChatSystemPrompt(makeRun(), [planV3, planV1]);
    expect(result).toContain("Newest");
    expect(result).not.toContain("Oldest");
  });
});
