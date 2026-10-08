import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run, Artifact } from "../../src/domain/types.js";

// Branch-focused companion to chatContextBuilder.test.ts: review sections,
// fallback placeholders for missing fields, and sections that must be
// omitted when their payload has nothing to render.

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-9",
    linearIssueId: "LIN-9",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: "Planning",
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/w",
    latestArtifactVersion: 1,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function art(type: string, payloadJson: unknown, version = 1): Artifact {
  return {
    id: `${type}-${version}`,
    runId: "run-9",
    type,
    version,
    payloadJson,
    rawText: "",
    createdAt: new Date("2024-01-01"),
  } as Artifact;
}

describe("buildChatSystemPrompt — metadata and Linear fallbacks", () => {
  it("renders (none) placeholders and omits the Linear section when no issue fields are set", () => {
    const out = buildChatSystemPrompt(makeRun(), []);
    expect(out).toContain("**Branch:** (none)");
    expect(out).toContain("**PR Number:** (none)");
    expect(out).toContain("**Plan Version:** 1");
    expect(out).not.toContain("## Linear Issue");
  });

  it("renders PR number 0 rather than (none)", () => {
    const out = buildChatSystemPrompt(makeRun({ prNumber: 0 }), []);
    expect(out).toContain("**PR Number:** 0");
  });

  it("renders a Linear section with only the description when that is the only field", () => {
    const out = buildChatSystemPrompt(makeRun({ linearIssueDescription: "Just a body" }), []);
    expect(out).toContain("## Linear Issue\n**Description:**\nJust a body");
    expect(out).not.toContain("**Identifier:**");
    expect(out).not.toContain("**Title:**");
  });
});

describe("buildChatSystemPrompt — plan section", () => {
  it("omits the plan section entirely when the Plan payload has nothing renderable", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art("Plan", { steps: [], risks: [], assumptions: [], openQuestions: [] }),
    ]);
    expect(out).not.toContain("## Current Plan");
  });

  it("uses empty strings for missing step fields and JSON for structured risks/assumptions/questions", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art(
        "Plan",
        {
          steps: [{}],
          risks: [{ description: "r1" }],
          assumptions: [{ a: 1 }],
          openQuestions: [{ id: "q1", question: "Why?" }, "plain question"],
        },
        4,
      ),
    ]);
    expect(out).toContain("## Current Plan (v4)");
    expect(out).toContain("  - **** : ");
    expect(out).toContain('**Risks:**\n  - {"description":"r1"}');
    expect(out).toContain('**Assumptions:**\n  - {"a":1}');
    expect(out).toContain(
      '**Open Questions:**\n  - {"id":"q1","question":"Why?"}\n  - plain question',
    );
    expect(out).not.toContain("**Summary:**");
  });
});

describe("buildChatSystemPrompt — answers", () => {
  it("omits Human Answers when the answers array is empty or missing", () => {
    expect(buildChatSystemPrompt(makeRun(), [art("HumanAnswers", { answers: [] })])).not.toContain(
      "## Human Answers",
    );
    expect(buildChatSystemPrompt(makeRun(), [art("HumanAnswers", {})])).not.toContain(
      "## Human Answers",
    );
  });

  it("renders empty placeholders for answers missing questionId/answer", () => {
    const out = buildChatSystemPrompt(makeRun(), [art("HumanAnswers", { answers: [{}] })]);
    expect(out).toContain("## Human Answers\n  - **[]:** ");
  });

  it("renders researched answers with missing fields and no summary line", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art("ResearchedAnswers", { answers: [{ sources: [] }] }),
    ]);
    expect(out).toContain(
      "## Researched Answers (AI best-effort, not authoritative)\n  - **[] ():** ",
    );
    expect(out).not.toContain("_(sources:");
  });

  it("omits Researched Answers when there are no answers", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art("ResearchedAnswers", { summary: "nothing", answers: [] }),
    ]);
    expect(out).not.toContain("## Researched Answers");
  });
});

describe.each([
  { type: "PlanReview", heading: "## Plan Review Findings" },
  { type: "Review", heading: "## Code Review Findings" },
])("buildChatSystemPrompt — $type section", ({ type, heading }) => {
  it("renders summary and every finding", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art(type, {
        summary: "Mostly fine",
        findings: [
          { id: "F1", severity: "high", title: "Missing tests", details: "Add coverage" },
          { id: "F2", severity: "low", title: "Naming", details: "Rename foo" },
        ],
      }),
    ]);
    expect(out).toContain(
      `${heading}\n**Summary:** Mostly fine\n` +
        "  - **[high] Missing tests** (F1): Add coverage\n" +
        "  - **[low] Naming** (F2): Rename foo",
    );
  });

  it("renders findings without a summary, using empty placeholders for missing fields", () => {
    const out = buildChatSystemPrompt(makeRun(), [art(type, { findings: [{}] })]);
    expect(out).toContain(`${heading}\n  - **[] ** (): `);
    expect(out).not.toContain(`${heading}\n**Summary:**`);
  });

  it("renders only the summary when findings are empty", () => {
    const out = buildChatSystemPrompt(makeRun(), [art(type, { summary: "LGTM", findings: [] })]);
    expect(out).toContain(`${heading}\n**Summary:** LGTM\n\n`);
  });

  it("omits the section when neither summary nor findings are present", () => {
    const out = buildChatSystemPrompt(makeRun(), [art(type, {})]);
    expect(out).not.toContain(heading);
  });

  it("uses the highest-version artifact", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art(type, { summary: "new" }, 3),
      art(type, { summary: "old" }, 1),
    ]);
    expect(out).toContain(`${heading}\n**Summary:** new`);
    expect(out).not.toContain("**Summary:** old");
  });
});

describe("buildChatSystemPrompt — execution report fallbacks", () => {
  it("omits the section when the payload has nothing renderable", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art("ExecutionReport", { filesChanged: [], notes: [] }),
    ]);
    expect(out).not.toContain("## Execution Report");
  });

  it("falls back to artifact version, '?' for missing checks, JSON for structured files/notes", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art(
        "ExecutionReport",
        {
          checks: { lint: { status: "pass" }, tests: { status: "fail", details: "2 failed" } },
          filesChanged: [{ path: "a.ts" }],
          notes: ["string note", { n: 1 }],
          prDraftCreated: false,
        },
        7,
      ),
    ]);
    expect(out).toContain("## Execution Report (v7)");
    expect(out).toContain(
      "**Checks:**\n  - **Lint:** pass\n  - **Typecheck:** ?\n  - **Tests:** fail — 2 failed",
    );
    expect(out).toContain('**Files Changed (1):**\n  - `{"path":"a.ts"}`');
    expect(out).toContain('**Notes:**\n  - string note\n  - {"n":1}');
    expect(out).toContain("**PR Draft Created:** no");
    expect(out).not.toContain("**Score:**");
  });

  it("formats a zero score and prefers executionVersion over artifact version", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art("ExecutionReport", { score: 0, executionVersion: 2 }, 9),
    ]);
    expect(out).toContain("## Execution Report (v2)\n**Score:** 0.00 (0%)");
  });
});

describe("buildChatSystemPrompt — rejection context fallbacks", () => {
  it("renders '?' and empty placeholders for missing rejection fields, one line per artifact", () => {
    const out = buildChatSystemPrompt(makeRun(), [
      art("RejectionContext", {}, 1),
      art("RejectionContext", { planVersion: 2, source: "api", mode: "fresh", feedback: "redo" }, 2),
    ]);
    expect(out).toContain(
      "## Rejection Context(s)\n  - **Plan v?** (, ): \n  - **Plan v2** (api, fresh): redo",
    );
  });
});
