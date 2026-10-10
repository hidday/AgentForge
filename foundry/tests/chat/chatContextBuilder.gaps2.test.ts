import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run, Artifact } from "../../src/domain/types.js";

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
    state: "Planning",
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

describe("buildChatSystemPrompt (additional branch gaps)", () => {
  it("renders only the identifier line when title/description are absent", () => {
    const run = makeRun({ linearIssueIdentifier: "ENG-1" });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-1");
    expect(result).not.toContain("**Title:**");
    expect(result).not.toContain("**Description:**");
  });

  it("renders only the title line when identifier/description are absent", () => {
    const run = makeRun({ linearIssueTitle: "Only title" });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**Title:** Only title");
    expect(result).not.toContain("**Identifier:**");
  });

  it("renders only the description line when identifier/title are absent", () => {
    const run = makeRun({ linearIssueDescription: "Only description" });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**Description:**\nOnly description");
    expect(result).not.toContain("**Identifier:**");
    expect(result).not.toContain("**Title:**");
  });

  it("includes Branch and PR Number when present", () => {
    const run = makeRun({ branchName: "feature/x", prNumber: 42 });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**Branch:** feature/x");
    expect(result).toContain("**PR Number:** 42");
  });

  it("omits the Current Plan section when the Plan artifact has no renderable fields", () => {
    const artifact = makeArtifact({ type: "Plan", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Current Plan");
  });

  it("stringifies non-string Plan risks and assumptions", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        risks: [{ severity: "high" }],
        assumptions: [{ note: "non-string assumption" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain('{"severity":"high"}');
    expect(result).toContain('{"note":"non-string assumption"}');
  });

  it("omits Human Answers section when the HumanAnswers artifact has an empty answers array", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Human Answers");
  });

  it("omits Researched Answers section when the artifact has an empty answers array", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: { summary: "nothing resolved", answers: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Researched Answers");
  });

  it("renders Researched Answers without a summary line when summary is absent", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: {
        answers: [{ questionId: "q1", answer: "A." }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers");
    expect(result).not.toContain("**Summary:**");
  });

  it("renders Plan Review Findings with only a summary (no findings)", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "Summary only" },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Summary only");
  });

  it("renders Plan Review Findings with only findings (no summary)", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        findings: [{ id: "f1", severity: "low", title: "Nit", details: "minor" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).not.toContain("**Summary:**");
    expect(result).toContain("[low] Nit");
  });

  it("renders Code Review Findings with only a summary (no findings)", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "Review summary only" },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("**Summary:** Review summary only");
  });

  it("renders Code Review Findings with only findings (no summary)", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        findings: [{ id: "f2", severity: "blocker", title: "Bug", details: "crashes" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).not.toContain("**Summary:**");
    expect(result).toContain("[blocker] Bug");
  });

  it("omits the Execution Report section entirely when the artifact has no renderable fields", () => {
    const artifact = makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Execution Report");
  });

  it("falls back to the artifact's own version when executionVersion is absent", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 7,
      payloadJson: { summary: "no explicit executionVersion" },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v7)");
  });

  it("renders check lines with '?' status and no details when a check is missing", () => {
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
  });

  it("omits Files Changed and Notes sections when both are empty arrays, and PR Draft Created when not boolean", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        summary: "trivial report",
        filesChanged: [],
        notes: [],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("**Files Changed");
    expect(result).not.toContain("**Notes:**");
    expect(result).not.toContain("**PR Draft Created:**");
  });

  it("renders a non-string file entry in Files Changed via JSON.stringify", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        filesChanged: [{ path: "src/foo.ts", renamed: true }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain('{"path":"src/foo.ts","renamed":true}');
  });

  it("renders a non-string note entry via JSON.stringify", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        notes: [{ kind: "warning" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain('{"kind":"warning"}');
  });

  it("renders 'PR Draft Created: no' when prDraftCreated is false", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: { summary: "x", prDraftCreated: false },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**PR Draft Created:** no");
  });

  it("renders Rejection Context with '?' / empty fallbacks when fields are missing", () => {
    const artifact = makeArtifact({ type: "RejectionContext", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Rejection Context(s)");
    expect(result).toContain("**Plan v?** (, ):");
  });

  it("omits Rejection Context section when there are no RejectionContext artifacts", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Rejection Context");
  });

  it("findLatest keeps the current best when a later artifact has a lower version", () => {
    const planV3 = makeArtifact({ type: "Plan", version: 3, payloadJson: { summary: "v3 summary" } });
    const planV1 = makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "v1 summary" } });
    const planV2 = makeArtifact({ type: "Plan", version: 2, payloadJson: { summary: "v2 summary" } });

    // Order matters: v3 is encountered first as "best", so comparing it against
    // v1 and v2 exercises the `cur.version > best.version` *false* branch.
    const result = buildChatSystemPrompt(makeRun(), [planV3, planV1, planV2]);
    expect(result).toContain("v3 summary");
    expect(result).not.toContain("v1 summary");
    expect(result).not.toContain("v2 summary");
  });
});
