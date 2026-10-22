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

  it("includes plan review findings when a PlanReview artifact is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan looks mostly complete.",
        findings: [
          { id: "pr1", severity: "important", title: "Missing rollback", details: "Add one" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Plan looks mostly complete.");
    expect(result).toContain("[important] Missing rollback");
  });

  it("omits the Plan Review Findings section when the PlanReview payload has no summary or findings", () => {
    const artifact = makeArtifact({ type: "PlanReview", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes code review findings when a Review artifact is present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One blocker found.",
        findings: [
          { id: "f1", severity: "blocker", title: "Null deref", details: "Will crash" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("One blocker found.");
    expect(result).toContain("[blocker] Null deref");
  });

  it("omits the Code Review Findings section when the Review payload has no summary or findings", () => {
    const artifact = makeArtifact({ type: "Review", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("includes open questions in the plan section", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { openQuestions: [{ id: "q1", question: "Which DB?" }] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain(JSON.stringify({ id: "q1", question: "Which DB?" }));
  });

  it("renders string risks/assumptions/openQuestions/notes directly instead of JSON-stringifying them", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        risks: ["Plain string risk"],
        assumptions: ["Plain string assumption"],
        openQuestions: ["Plain string question"],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("  - Plain string risk");
    expect(result).toContain("  - Plain string assumption");
    expect(result).toContain("  - Plain string question");
  });

  it("renders multiple RejectionContext artifacts, one line each", () => {
    const rej1 = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: { planVersion: 1, feedback: "First rejection", source: "api", mode: "iterate" },
    });
    const rej2 = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear", mode: "fresh" },
    });
    const result = buildChatSystemPrompt(makeRun(), [rej1, rej2]);
    expect(result).toContain("First rejection");
    expect(result).toContain("Second rejection");
    expect(result).toContain("Plan v1");
    expect(result).toContain("Plan v2");
  });

  it("falls back to '?' for a RejectionContext missing planVersion/source/mode", () => {
    const rej = makeArtifact({ type: "RejectionContext", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [rej]);
    expect(result).toContain("**Plan v?** (, ):");
  });

  it("falls back to '(none)' for a missing branchName and prNumber in run metadata", () => {
    const result = buildChatSystemPrompt(
      makeRun({ branchName: null, prNumber: null }),
      [],
    );
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });

  it("omits the Linear Issue section entirely when title, identifier, and description are all absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueDescription: null }),
      [],
    );
    expect(result).not.toContain("## Linear Issue");
  });

  it("renders only the Linear identifier when title and description are absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-7", linearIssueDescription: null }),
      [],
    );
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-7");
    expect(result).not.toContain("**Title:**");
  });

  it("omits the Checks block when the execution report payload has no checks field", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: { summary: "No checks reported." },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report");
    expect(result).not.toContain("**Checks:**");
  });

  it("omits the entire Execution Report section when the payload has nothing renderable", () => {
    const artifact = makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Execution Report");
  });

  it("falls back to the artifact's own version when executionVersion is absent from the payload", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 5,
      payloadJson: { summary: "No executionVersion field." },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v5)");
  });

  it("stringifies a non-string file entry in filesChanged", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: { filesChanged: [{ path: "weird.ts" }] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain(JSON.stringify({ path: "weird.ts" }));
  });

  it("stringifies a non-string note entry", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: { notes: [{ code: "W1" }] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain(JSON.stringify({ code: "W1" }));
  });

  it("renders a Review finding missing severity/title/id/details with empty-string fallbacks", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[] ** ():");
  });

  it("keeps the earlier artifact as 'best' when a later one does not have a higher version", () => {
    const planV3 = makeArtifact({ type: "Plan", version: 3, payloadJson: { summary: "v3" } });
    const planV1 = makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "v1" } });
    const result = buildChatSystemPrompt(makeRun(), [planV3, planV1]);
    expect(result).toContain("v3");
    expect(result).not.toContain("v1");
  });

  it("stringifies non-string plan risks/assumptions/openQuestions and falls back to '' for missing step fields", () => {
    const plan = makeArtifact({
      type: "Plan",
      payloadJson: {
        summary: "s",
        steps: [{}], // missing id/title/description
        risks: [{ code: "R1" }], // non-string -> JSON.stringify
        assumptions: [{ code: "A1" }],
        openQuestions: [{ code: "Q1" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [plan]);
    expect(result).toContain("**** : "); // step id/title/description all fell back to ""
    expect(result).toContain('{"code":"R1"}');
    expect(result).toContain('{"code":"A1"}');
    expect(result).toContain('{"code":"Q1"}');
  });

  it("falls back to '' for missing HumanAnswers questionId/answer fields", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[]:** ");
  });

  it("falls back to '' for missing ResearchedAnswers fields and omits the summary line when absent", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      payloadJson: { answers: [{}] }, // no summary, no questionId/confidence/answer/sources
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[] ():** ");
    expect(result).not.toContain("**Summary:**");
  });

  it("falls back to '' for a PlanReview finding missing severity/title/id/details", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[] ** ():");
  });

  it("falls back to '?' status and omits the dash-details suffix when a check has no details", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      payloadJson: {
        checks: {
          lint: {}, // no status, no details
          typecheck: { status: "pass" }, // status but no details
          tests: { status: "pass", details: "all good" },
        },
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Lint:** ?");
    expect(result).toContain("**Typecheck:** pass");
    expect(result).not.toContain("**Typecheck:** pass —");
    expect(result).toContain("**Tests:** pass — all good");
  });
});
