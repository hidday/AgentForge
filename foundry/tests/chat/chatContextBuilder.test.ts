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

  it("includes plan open questions when present, stringifying non-string entries", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: ["Should we use Postgres?", { id: "q2", question: "Object-shaped one" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Should we use Postgres?");
    expect(result).toContain(JSON.stringify({ id: "q2", question: "Object-shaped one" }));
  });

  it("omits the Open Questions sub-section when the plan has none", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Plan summary", openQuestions: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).not.toContain("**Open Questions:**");
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

  it("includes plan review findings when PlanReview artifact present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan mostly sound, one gap.",
        findings: [
          {
            id: "f1",
            severity: "important",
            title: "Missing rollback plan",
            details: "No rollback step if migration fails.",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Plan mostly sound, one gap.");
    expect(result).toContain("**[important] Missing rollback plan** (f1): No rollback step if migration fails.");
  });

  it("renders a PlanReview section from summary alone when findings are absent", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Approved with no findings.",
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Approved with no findings.");
  });

  it("omits the Plan Review Findings section when the PlanReview payload has neither summary nor findings", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("omits the Plan Review Findings section when no PlanReview artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes code review findings when Review artifact present, defaulting missing finding fields to empty", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Code review complete.",
        findings: [
          { id: "f1", severity: "nit", title: "Long line" },
          {},
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("**Summary:** Code review complete.");
    expect(result).toContain("**[nit] Long line** (f1): ");
    // second finding has no fields at all -- should still render with empty placeholders
    expect(result).toContain("**[] ** (): ");
  });

  it("omits the Code Review Findings section when the Review payload has neither summary nor findings", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("omits the Code Review Findings section when no Review artifact exists", () => {
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

  it("keeps the earlier artifact when later artifacts of the same type do not have a higher version", () => {
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
  });

  it("falls back to placeholder run metadata when branchName and prNumber are absent", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });

  it("renders check status as '?' and omits the details suffix when a check entry is missing", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        executionVersion: 1,
        checks: {},
        score: 0.5,
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Lint:** ?");
    expect(result).toContain("**Typecheck:** ?");
    expect(result).toContain("**Tests:** ?");
    expect(result).not.toContain(" — ");
  });

  it("stringifies non-string filesChanged and notes entries in the execution report", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        executionVersion: 1,
        score: 0.5,
        filesChanged: [{ path: "src/foo.ts" }],
        notes: [{ note: "structured note" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain(JSON.stringify({ path: "src/foo.ts" }));
    expect(result).toContain(JSON.stringify({ note: "structured note" }));
  });

  it("defaults RejectionContext fields to placeholders when the payload is empty", () => {
    const artifact = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Rejection Context(s)");
    expect(result).toContain("**Plan v?** (, ):");
  });

  it("defaults HumanAnswers entry fields to empty strings when missing", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[]:** ");
  });

  it("defaults ResearchedAnswers entry fields to empty strings when missing", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[] ():** ");
  });
});
