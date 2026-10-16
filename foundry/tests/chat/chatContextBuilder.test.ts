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

  it("includes plan open questions when present", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: ["Should we support multi-tenant mode?"],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Should we support multi-tenant mode?");
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

  it("falls back to empty strings for researched answers missing fields and no summary", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: {
        answers: [{}],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers");
    expect(result).toContain("  - **[] ():** ");
    expect(result).not.toContain("**Summary:**");
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

  it("includes plan review findings when PlanReview artifact present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan has a scoping gap.",
        findings: [
          {
            id: "pr1",
            severity: "high",
            title: "Missing migration step",
            details: "The plan does not account for the DB migration.",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Plan has a scoping gap.");
    expect(result).toContain("**[high] Missing migration step** (pr1): The plan does not account for the DB migration.");
  });

  it("omits Plan Review Findings section when no PlanReview artifact present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes code review findings when Review artifact present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One blocking issue found.",
        findings: [
          {
            id: "r1",
            severity: "critical",
            title: "SQL injection risk",
            details: "User input is concatenated directly into the query.",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("**Summary:** One blocking issue found.");
    expect(result).toContain("**[critical] SQL injection risk** (r1): User input is concatenated directly into the query.");
  });

  it("omits Code Review Findings section when no Review artifact present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
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

  it("findLatest keeps the earlier artifact when it already has the higher version", () => {
    // Exercises the reduce() branch where `best` is kept (cur.version is not
    // greater than best.version), as opposed to the prior test where `cur` wins.
    const planV2First = makeArtifact({
      type: "Plan",
      version: 2,
      payloadJson: { summary: "Higher version, listed first" },
    });
    const planV1Second = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Lower version, listed second" },
    });
    const result = buildChatSystemPrompt(makeRun(), [planV2First, planV1Second]);
    expect(result).toContain("Higher version, listed first");
    expect(result).not.toContain("Lower version, listed second");
    expect(result).toContain("## Current Plan (v2)");
  });

  it("renders '(none)' for missing branchName and prNumber", () => {
    const result = buildChatSystemPrompt(
      makeRun({ branchName: null, prNumber: null }),
      [],
    );
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });

  it("renders actual branchName and prNumber when present", () => {
    const result = buildChatSystemPrompt(
      makeRun({ branchName: "feature/abc", prNumber: 7 }),
      [],
    );
    expect(result).toContain("**Branch:** feature/abc");
    expect(result).toContain("**PR Number:** 7");
  });

  it("omits the Linear Issue section entirely when all three fields are falsy", () => {
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

  it("renders only the identifier when title and description are absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: "ENG-7",
        linearIssueDescription: null,
      }),
      [],
    );
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-7");
    expect(result).not.toContain("**Title:**");
    expect(result).not.toContain("**Description:**");
  });

  it("falls back to empty strings for plan steps missing id/title/description", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        steps: [{}],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("  - **** : ");
  });

  it("JSON.stringifies non-string risks, assumptions, and open questions", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        risks: [{ kind: "risk-object" }],
        assumptions: [{ kind: "assumption-object" }],
        openQuestions: [{ kind: "question-object" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain(JSON.stringify({ kind: "risk-object" }));
    expect(result).toContain(JSON.stringify({ kind: "assumption-object" }));
    expect(result).toContain(JSON.stringify({ kind: "question-object" }));
  });

  it("omits the Human Answers section when the answers array is empty", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Human Answers");
  });

  it("falls back to empty strings for human answers missing questionId/answer", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("  - **[]:** ");
  });

  it("falls back to empty strings for plan review findings missing fields", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("  - **[] ** (): ");
  });

  it("falls back to empty strings for code review findings missing fields", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("  - **[] ** (): ");
  });

  it("renders '?' for missing check status and omits the details suffix", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        checks: {},
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Lint:** ?");
    expect(result).toContain("**Typecheck:** ?");
    expect(result).toContain("**Tests:** ?");
    expect(result).not.toContain(" — ");
  });

  it("falls back to the artifact's own version when executionVersion is absent", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 3,
      payloadJson: {
        summary: "No explicit executionVersion field.",
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v3)");
  });

  it("JSON.stringifies non-string filesChanged and notes entries", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        filesChanged: [{ path: "src/foo.ts" }],
        notes: [{ note: "structured note" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain(JSON.stringify({ path: "src/foo.ts" }));
    expect(result).toContain(JSON.stringify({ note: "structured note" }));
  });

  it("renders 'no' for PR Draft Created when explicitly false", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        summary: "Draft not created.",
        prDraftCreated: false,
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**PR Draft Created:** no");
  });

  it("falls back to '?' for rejection context fields missing planVersion/source/mode/feedback", () => {
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
