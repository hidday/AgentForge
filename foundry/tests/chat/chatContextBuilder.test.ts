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

  it("includes open questions in the plan section, JSON-stringifying non-string entries", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "s",
        openQuestions: [
          "Plain string question?",
          { id: "q1", question: "Object question?" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Plain string question?");
    expect(result).toContain(JSON.stringify({ id: "q1", question: "Object question?" }));
  });

  it("JSON-stringifies non-string risk and assumption entries in the plan section", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "s",
        risks: [{ risk: "structured risk" }],
        assumptions: [{ assumption: "structured assumption" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain(JSON.stringify({ risk: "structured risk" }));
    expect(result).toContain(JSON.stringify({ assumption: "structured assumption" }));
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

  it("includes plan review findings section when PlanReview artifact present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "One blocker found in the plan.",
        findings: [
          {
            id: "pr1",
            severity: "blocker",
            title: "Missing rollback plan",
            details: "No rollback strategy described.",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** One blocker found in the plan.");
    expect(result).toContain("[blocker] Missing rollback plan** (pr1): No rollback strategy described.");
  });

  it("omits plan review findings section when PlanReview artifact has no summary and no findings", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("omits plan review findings section when no PlanReview artifact present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes code review findings section when Review artifact present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Found a bug and a nit.",
        findings: [
          {
            id: "f1",
            severity: "important",
            title: "Null deref",
            details: "foo can be null here.",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("**Summary:** Found a bug and a nit.");
    expect(result).toContain("[important] Null deref** (f1): foo can be null here.");
  });

  it("omits code review findings section when Review artifact has no summary and no findings", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("omits code review findings section when no Review artifact present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
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

  it("findLatest keeps the running-best artifact when a later one has a lower version", () => {
    const planV2 = makeArtifact({ type: "Plan", version: 2, payloadJson: { summary: "Best" } });
    const planV1 = makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "Worse" } });
    const result = buildChatSystemPrompt(makeRun(), [planV2, planV1]);
    expect(result).toContain("Best");
    expect(result).not.toContain("Worse");
  });

  it("falls back to '(none)' for branchName/prNumber and omits the Linear Issue section when unset", () => {
    const run = makeRun({
      branchName: null,
      prNumber: null,
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueDescription: null,
    });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
    expect(result).not.toContain("## Linear Issue");
  });

  it("falls back to '?'/'' placeholders for missing fields across plan steps/risks/assumptions/openQuestions", () => {
    const plan = makeArtifact({
      type: "Plan",
      payloadJson: {
        steps: [{}],
        risks: [{ note: "structured risk" }],
        assumptions: [{ note: "structured assumption" }],
        openQuestions: [{ q: "structured question" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [plan]);
    expect(result).toContain("**Steps:**");
    expect(result).toContain("  - **** : ");
    expect(result).toContain(JSON.stringify({ note: "structured risk" }));
    expect(result).toContain(JSON.stringify({ note: "structured assumption" }));
    expect(result).toContain(JSON.stringify({ q: "structured question" }));
  });

  it("falls back to '' placeholders for missing fields in Human Answers, PlanReview, and Review findings", () => {
    const humanAnswers = makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{}] } });
    const planReview = makeArtifact({
      type: "PlanReview",
      payloadJson: { findings: [{}] },
    });
    const review = makeArtifact({ type: "Review", payloadJson: { findings: [{}] } });
    const result = buildChatSystemPrompt(makeRun(), [humanAnswers, planReview, review]);
    expect(result).toContain("## Human Answers");
    expect(result).toContain("  - **[]:** ");
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("  - **[] ** (): ");
  });

  it("falls back to '' placeholders for missing fields on a researched answer", () => {
    const researched = makeArtifact({
      type: "ResearchedAnswers",
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [researched]);
    expect(result).toContain("  - **[] ():** ");
  });

  it("omits the sources parenthetical and summary line when a researched answer has neither", () => {
    const researched = makeArtifact({
      type: "ResearchedAnswers",
      payloadJson: { answers: [{ questionId: "q1", answer: "Yes", confidence: "high" }] },
    });
    const result = buildChatSystemPrompt(makeRun(), [researched]);
    expect(result).toContain("**[q1] (high):** Yes");
    expect(result).not.toContain("_(sources:");
    expect(result).not.toMatch(/\*\*Summary:\*\* .*\n\s*- \*\*\[q1\]/);
  });

  it("renders '?' status and omits the details dash for checks with missing status/details", () => {
    const execReport = makeArtifact({
      type: "ExecutionReport",
      payloadJson: { checks: {} },
    });
    const result = buildChatSystemPrompt(makeRun(), [execReport]);
    expect(result).toContain("**Lint:** ?");
    expect(result).toContain("**Typecheck:** ?");
    expect(result).toContain("**Tests:** ?");
    expect(result).not.toContain(" — ");
  });

  it("uses the artifact's own version when executionVersion is absent from the ExecutionReport payload", () => {
    const execReport = makeArtifact({
      type: "ExecutionReport",
      version: 7,
      payloadJson: { summary: "done" },
    });
    const result = buildChatSystemPrompt(makeRun(), [execReport]);
    expect(result).toContain("## Execution Report (v7)");
  });

  it("stringifies non-string filesChanged/notes entries in the Execution Report", () => {
    const execReport = makeArtifact({
      type: "ExecutionReport",
      payloadJson: {
        filesChanged: [{ path: "src/a.ts" }],
        notes: [{ note: "structured note" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [execReport]);
    expect(result).toContain(JSON.stringify({ path: "src/a.ts" }));
    expect(result).toContain(JSON.stringify({ note: "structured note" }));
  });

  it("falls back to '?'/'' placeholders for missing fields on RejectionContext artifacts", () => {
    const rejection = makeArtifact({ type: "RejectionContext", payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [rejection]);
    expect(result).toContain("## Rejection Context(s)");
    expect(result).toContain("  - **Plan v?** (, ): ");
  });
});
