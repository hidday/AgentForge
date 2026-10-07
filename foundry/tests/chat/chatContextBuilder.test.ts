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

describe("buildChatSystemPrompt", () => {
  it("returns a non-empty string even for a run with zero artifacts", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("always includes the advisory footer text", () => {
    const result1 = buildChatSystemPrompt(makeRun(), []);
    expect(result1).toContain("READ-ONLY advisory mode");

    const result2 = buildChatSystemPrompt(makeRun({ linearIssueTitle: null }), []);
    expect(result2).toContain("READ-ONLY advisory mode");
  });

  it("returns a string containing the Linear issue title when present", () => {
    const run = makeRun({ linearIssueTitle: "Feature XYZ" });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("Feature XYZ");
  });

  it("omits plan section when no Plan artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Current Plan");
  });

  it("includes plan steps, risks, assumptions when Plan artifact present", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        steps: [{ id: "s1", title: "Step One", description: "Do step one" }],
        risks: ["Risk A"],
        assumptions: ["Assumption B"],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("## Current Plan");
    expect(result).toContain("Step One");
    expect(result).toContain("Risk A");
    expect(result).toContain("Assumption B");
    expect(result).toContain("Plan summary");
  });

  it("JSON-stringifies non-string plan steps/risks/assumptions and falls back on missing step fields", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        steps: [{}],
        risks: [{ note: "non-string risk" }],
        assumptions: [{ note: "non-string assumption" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("  - **** : ");
    expect(result).toContain(JSON.stringify({ note: "non-string risk" }));
    expect(result).toContain(JSON.stringify({ note: "non-string assumption" }));
  });

  it("includes human answers section when HumanAnswers artifact present", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: {
        answers: [
          { questionId: "q1", answer: "Answer to question 1" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Human Answers");
    expect(result).toContain("Answer to question 1");
  });

  it("falls back to empty strings for human answers missing questionId/answer fields", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Human Answers");
    expect(result).toContain("  - **[]:** ");
  });

  it("includes researched answers section when ResearchedAnswers artifact present", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: {
        summary: "Resolved 1 of 1 open questions using repo conventions.",
        answers: [
          {
            questionId: "q1",
            question: "Should we use camelCase?",
            answer: "Yes, all existing schemas use camelCase.",
            confidence: "high",
            sources: ["src/schemas/foo.ts"],
          },
        ],
        completedAt: "2026-05-17T12:00:00Z",
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers");
    expect(result).toContain("AI best-effort, not authoritative");
    expect(result).toContain("Resolved 1 of 1 open questions");
    expect(result).toContain("[q1] (high)");
    expect(result).toContain("Yes, all existing schemas use camelCase.");
    expect(result).toContain("sources: src/schemas/foo.ts");
  });

  it("renders Researched Answers without sources when sources are absent", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: {
        summary: "Partial coverage.",
        answers: [
          {
            questionId: "q1",
            question: "Q?",
            answer: "A.",
            confidence: "medium",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers");
    expect(result).toContain("[q1] (medium)");
    expect(result).not.toContain("sources:");
  });

  it("falls back to empty strings and omits the Summary line for a researched answer with no summary/fields", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers");
    expect(result).toContain("  - **[] ():** ");
    expect(result).not.toMatch(/## Researched Answers[^\n]*\n\*\*Summary:\*\*/);
  });

  it("omits Researched Answers section when no ResearchedAnswers artifact present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Researched Answers");
  });

  it("includes rejection context when RejectionContext artifact present", () => {
    const artifact = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: {
        planVersion: 1,
        feedback: "The plan was incomplete",
        source: "api",
        mode: "iterate",
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("Rejection Context");
    expect(result).toContain("The plan was incomplete");
  });

  it("renders execution report as structured markdown with score, checks, files", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 2,
      payloadJson: {
        executionVersion: 2,
        summary: "Shipped the feature.",
        filesChanged: ["src/foo.ts", "src/bar.ts"],
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "1 flake" },
        },
        notes: ["Skipped boundary tests"],
        prDraftCreated: true,
        score: 0.82,
        scoreRationale: "Solid implementation; one flaky test remains.",
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v2)");
    expect(result).toContain("**Score:** 0.82 (82%)");
    expect(result).toContain("**Score Rationale:** Solid implementation");
    expect(result).toContain("**Summary:**");
    expect(result).toContain("Shipped the feature.");
    expect(result).toContain("**Checks:**");
    expect(result).toContain("**Lint:** pass");
    expect(result).toContain("**Tests:** fail");
    expect(result).toContain("**Files Changed (2):**");
    expect(result).toContain("`src/foo.ts`");
    expect(result).toContain("**Notes:**");
    expect(result).toContain("Skipped boundary tests");
    expect(result).toContain("**PR Draft Created:** yes");
  });

  it("JSON-stringifies non-string execution report filesChanged entries", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: { filesChanged: [{ path: "src/foo.ts", renamed: true }] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain(JSON.stringify({ path: "src/foo.ts", renamed: true }));
  });

  it("JSON-stringifies non-string execution report notes", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: { notes: [{ kind: "gotcha", detail: "watch the cache" }] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain(JSON.stringify({ kind: "gotcha", detail: "watch the cache" }));
  });

  it("truncates very long execution report summary to 4000 chars", () => {
    const longSummary = "x".repeat(10000);
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        executionVersion: 1,
        summary: longSummary,
        filesChanged: [],
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
        notes: [],
        prDraftCreated: false,
        score: 0.7,
        scoreRationale: "Truncation fixture: score not the focus of this test.",
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("(truncated)");
    expect(result).toContain("x".repeat(4000));
    expect(result).not.toContain("x".repeat(4001));
  });

  it("renders (none) for a missing branch and PR number", () => {
    const result = buildChatSystemPrompt(makeRun({ branchName: null, prNumber: null }), []);
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });

  it("omits the Linear Issue section when no linear fields are present", () => {
    const result = buildChatSystemPrompt(
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueDescription: null,
      }),
      [],
    );
    expect(result).not.toContain("## Linear Issue");
  });

  it("renders only the identifier line when title/description are absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-7", linearIssueDescription: null }),
      [],
    );
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-7");
    expect(result).not.toContain("**Title:**");
    expect(result).not.toContain("**Description:**");
  });

  it("includes open questions in the plan section when present", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: ["Should we cache results?", { id: "q1", question: "Structured form?" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Should we cache results?");
    expect(result).toContain(JSON.stringify({ id: "q1", question: "Structured form?" }));
  });

  it("omits the plan section entirely when the Plan artifact has no renderable fields", () => {
    const planArtifact = makeArtifact({ type: "Plan", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).not.toContain("## Current Plan");
  });

  it("omits the Human Answers section when answers array is empty", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Human Answers");
  });

  it("includes Plan Review Findings section when PlanReview artifact present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Needs more detail on rollback.",
        findings: [
          { id: "pf1", severity: "important", title: "Missing rollback plan", details: "No rollback step." },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Needs more detail on rollback.");
    expect(result).toContain("Missing rollback plan");
  });

  it("falls back to empty strings for a plan review finding missing severity/title/id/details", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("  - **[] ** (): ");
  });

  it("omits Plan Review Findings section when there is no summary and no findings", () => {
    const artifact = makeArtifact({ type: "PlanReview", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes Code Review Findings section when Review artifact present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One blocking issue found.",
        findings: [
          { id: "f1", severity: "blocker", title: "SQL injection risk", details: "Unescaped input." },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("One blocking issue found.");
    expect(result).toContain("SQL injection risk");
  });

  it("omits Code Review Findings section when there is no summary and no findings", () => {
    const artifact = makeArtifact({ type: "Review", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("falls back to empty strings for a code review finding missing severity/title/id/details", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("  - **[] ** (): ");
  });

  it("renders multiple RejectionContext artifacts, one line each, with missing-field fallbacks", () => {
    const rej1 = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: { planVersion: 1, feedback: "First rejection", source: "api", mode: "iterate" },
    });
    const rej2 = makeArtifact({ type: "RejectionContext", version: 2, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [rej1, rej2]);
    expect(result).toContain("## Rejection Context(s)");
    expect(result).toContain("First rejection");
    expect(result).toContain("**Plan v?**");
  });

  it("omits the Checks block when ExecutionReport payload has no checks, and renders missing score/summary/files/notes gracefully", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Execution Report");
  });

  it("omits the em-dash details suffix for a check with no details", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        checks: {
          lint: { status: "pass" },
          typecheck: { status: "pass" },
          tests: { status: "pass" },
        },
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Lint:** pass");
    expect(result).not.toContain("**Lint:** pass —");
  });

  it("renders '?' for a check that is entirely absent from the checks object", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: { checks: {} },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Lint:** ?");
  });

  it("uses the artifact's own version when executionVersion is absent on the payload", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 3,
      payloadJson: { summary: "Did the work" },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v3)");
  });

  it("uses the Plan artifact with the highest version when multiple exist", () => {
    const planV1 = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Old summary" },
    });
    const planV2 = makeArtifact({
      type: "Plan",
      version: 2,
      payloadJson: { summary: "New summary" },
    });
    const result = buildChatSystemPrompt(makeRun(), [planV1, planV2]);
    expect(result).toContain("New summary");
    expect(result).not.toContain("Old summary");
  });

  it("uses the highest version even when artifacts are supplied in descending order", () => {
    const planV2 = makeArtifact({
      type: "Plan",
      version: 2,
      payloadJson: { summary: "Latest summary" },
    });
    const planV1 = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Earlier summary" },
    });
    const result = buildChatSystemPrompt(makeRun(), [planV2, planV1]);
    expect(result).toContain("Latest summary");
    expect(result).not.toContain("Earlier summary");
  });
});
