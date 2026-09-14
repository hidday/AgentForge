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

  it("includes plan open questions when present", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: [{ id: "q1", question: "Which env?" }, "raw string question"],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Which env?");
    expect(result).toContain("raw string question");
  });

  it("includes plan review findings and summary when a PlanReview artifact is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan looks solid overall.",
        findings: [
          { id: "pr1", severity: "important", title: "Missing tests", details: "No coverage for edge case" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Plan looks solid overall.");
    expect(result).toContain("[important] Missing tests");
    expect(result).toContain("No coverage for edge case");
  });

  it("omits the PlanReview section when summary and findings are both absent", () => {
    const artifact = makeArtifact({ type: "PlanReview", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes code review findings and summary when a Review artifact is present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One blocker found.",
        findings: [
          { id: "r1", severity: "blocker", title: "SQL injection risk", details: "Unescaped input" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("One blocker found.");
    expect(result).toContain("[blocker] SQL injection risk");
    expect(result).toContain("Unescaped input");
  });

  it("omits the Review section when summary and findings are both absent", () => {
    const artifact = makeArtifact({ type: "Review", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
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

  it("findLatest keeps the earlier artifact when a later one has a lower version", () => {
    const planV3 = makeArtifact({
      type: "Plan",
      version: 3,
      payloadJson: { summary: "Highest version summary" },
    });
    const planV1 = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Lower version summary" },
    });
    // v3 listed first so the reduce's `cur.version > best.version` false branch fires for v1.
    const result = buildChatSystemPrompt(makeRun(), [planV3, planV1]);
    expect(result).toContain("Highest version summary");
    expect(result).not.toContain("Lower version summary");
  });

  describe("null/missing metadata and field defaults", () => {
    it("renders '(none)' for a null branchName and prNumber", () => {
      const result = buildChatSystemPrompt(makeRun({ branchName: null, prNumber: null }), []);
      expect(result).toContain("**Branch:** (none)");
      expect(result).toContain("**PR Number:** (none)");
    });

    it("omits the Linear Issue section entirely when title, identifier and description are all absent", () => {
      const result = buildChatSystemPrompt(
        makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueDescription: null }),
        [],
      );
      expect(result).not.toContain("## Linear Issue");
    });

    it("defaults step id/title/description, and stringifies non-string risks/assumptions/openQuestions", () => {
      const artifact = makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: {
          steps: [{}],
          risks: [{ level: "high" }],
          assumptions: [{ note: "x" }],
          openQuestions: [{ id: "q1" }],
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("**** : ");
      expect(result).toContain('{"level":"high"}');
      expect(result).toContain('{"note":"x"}');
      expect(result).toContain('{"id":"q1"}');
    });

    it("defaults HumanAnswers questionId/answer to '' when absent", () => {
      const artifact = makeArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{}] },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("**[]:**");
    });

    it("omits the summary line and sources suffix in Researched Answers when both are absent", () => {
      const artifact = makeArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: { answers: [{ sources: [] }] },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Researched Answers");
      expect(result).not.toContain("**Summary:**");
      expect(result).not.toContain("sources:");
    });

    it("defaults PlanReview finding fields to '' when absent", () => {
      const artifact = makeArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { findings: [{}] },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Plan Review Findings");
      expect(result).toContain("**[] ** ():");
    });

    it("defaults Review (code review) finding fields to '' when absent", () => {
      const artifact = makeArtifact({
        type: "Review",
        version: 1,
        payloadJson: { findings: [{}] },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Code Review Findings");
      expect(result).toContain("**[] ** ():");
    });

    it("renders '?' status and omits the details suffix when a check is missing/incomplete", () => {
      const artifact = makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: { checks: {} },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("**Lint:** ?");
      expect(result).not.toContain("Lint:** ? —");
    });

    it("stringifies non-string filesChanged and notes entries", () => {
      const artifact = makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: {
          filesChanged: [{ path: "a.ts" }],
          notes: [{ note: "b" }],
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain('{"path":"a.ts"}');
      expect(result).toContain('{"note":"b"}');
    });

    it("omits the Execution Report section entirely when the payload yields no report lines", () => {
      const artifact = makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: {} });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).not.toContain("## Execution Report");
    });

    it("defaults RejectionContext fields to '?'/'' when absent", () => {
      const artifact = makeArtifact({ type: "RejectionContext", version: 1, payloadJson: {} });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Rejection Context(s)");
      expect(result).toContain("**Plan v?** (, ):");
    });
  });
});
