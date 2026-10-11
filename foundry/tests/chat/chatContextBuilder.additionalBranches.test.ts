import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run, Artifact } from "../../src/domain/types.js";

// Closes branches left uncovered by chatContextBuilder.test.ts: the PlanReview
// and Review ("Code Review Findings") sections were never exercised at all,
// plan.openQuestions was never populated, several Run-metadata "falsy" /
// nullish-fallback branches were never hit (all fields are truthy in the base
// fixture), multiple RejectionContext artifacts were never tested, and several
// ExecutionReport field-presence branches (checks/filesChanged/notes/
// prDraftCreated/score all absent) were never hit.

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

describe("buildChatSystemPrompt: Run Metadata nullish fallbacks", () => {
  it("renders '(none)' for branchName and prNumber when both are null", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });

  it("renders prNumber 0 as '0', not '(none)' (nullish, not falsy, check)", () => {
    const run = makeRun({ prNumber: 0 });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**PR Number:** 0");
  });
});

describe("buildChatSystemPrompt: Linear Issue section omission", () => {
  it("omits the Linear Issue section entirely when title, identifier and description are all absent", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueDescription: null,
    });
    const result = buildChatSystemPrompt(run, []);
    expect(result).not.toContain("## Linear Issue");
  });

  it("includes only the identifier line when title and description are absent", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: "ENG-7",
      linearIssueDescription: null,
    });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-7");
    expect(result).not.toContain("**Title:**");
    expect(result).not.toContain("**Description:**");
  });
});

describe("buildChatSystemPrompt: Plan openQuestions", () => {
  it("includes open questions (string and object forms) when present", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: ["Plain string question", { id: "q2", question: "Structured question" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Plain string question");
    expect(result).toContain('"question":"Structured question"');
  });
});

describe("buildChatSystemPrompt: HumanAnswers omission", () => {
  it("omits the Human Answers section when the answers array is empty", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Human Answers");
  });
});

describe("buildChatSystemPrompt: Plan Review Findings section", () => {
  it("includes the Plan Review Findings section with summary and findings when present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Mostly solid, one concern.",
        findings: [
          { id: "f1", severity: "blocker", title: "Missing rollback plan", details: "Add one" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Mostly solid, one concern.");
    expect(result).toContain("**[blocker] Missing rollback plan** (f1): Add one");
  });

  it("omits the Plan Review Findings section when summary and findings are both absent", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes only the summary line when findings is an empty array", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "Approved outright.", findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("**Summary:** Approved outright.");
  });
});

describe("buildChatSystemPrompt: Code Review Findings section", () => {
  it("includes the Code Review Findings section with summary and findings when present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One nit, otherwise good.",
        findings: [
          { id: "r1", severity: "nit", title: "Naming", details: "Rename variable foo" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("**Summary:** One nit, otherwise good.");
    expect(result).toContain("**[nit] Naming** (r1): Rename variable foo");
  });

  it("omits the Code Review Findings section when summary and findings are both absent", () => {
    const artifact = makeArtifact({ type: "Review", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });
});

describe("buildChatSystemPrompt: multiple RejectionContext artifacts", () => {
  it("lists every RejectionContext artifact, not just the latest", () => {
    const r1 = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: { planVersion: 1, feedback: "First rejection", source: "api", mode: "fresh" },
    });
    const r2 = makeArtifact({
      type: "RejectionContext",
      version: 2,
      payloadJson: { planVersion: 2, feedback: "Second rejection", source: "linear", mode: "iterate" },
    });
    const result = buildChatSystemPrompt(makeRun(), [r1, r2]);
    expect(result).toContain("First rejection");
    expect(result).toContain("Second rejection");
    expect(result).toContain("Plan v1");
    expect(result).toContain("Plan v2");
  });
});

describe("buildChatSystemPrompt: nullish-coalescing fallback branches on optional sub-fields", () => {
  it("falls back to empty strings for a plan step missing id/title/description", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { steps: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Steps:**\n  - **** : ");
  });

  it("JSON-stringifies non-string risk and assumption entries", () => {
    const artifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        risks: [{ risk: "structured risk" }],
        assumptions: [{ assumption: "structured assumption" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain('{"risk":"structured risk"}');
    expect(result).toContain('{"assumption":"structured assumption"}');
  });

  it("falls back to empty strings for a human answer missing questionId/answer", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[]:**");
  });

  it("falls back to empty strings for a researched answer missing questionId/confidence/answer", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[] ():**");
  });

  it("falls back to empty strings for a plan review finding missing severity/title/id/details", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "s", findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[] ** (): ");
  });

  it("falls back to empty strings for a code review finding missing severity/title/id/details", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "s", findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[] ** (): ");
  });

  it("falls back to '?' / empty strings for a rejection context missing all optional fields", () => {
    const artifact = makeArtifact({ type: "RejectionContext", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Plan v?** (, ): ");
  });

  it("findLatest keeps the earlier artifact when a later one in the array has a lower version", () => {
    const planV2First = makeArtifact({
      type: "Plan",
      version: 2,
      payloadJson: { summary: "Higher version summary" },
    });
    const planV1Second = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Lower version summary" },
    });
    const result = buildChatSystemPrompt(makeRun(), [planV2First, planV1Second]);
    expect(result).toContain("Higher version summary");
    expect(result).not.toContain("Lower version summary");
  });
});

describe("buildChatSystemPrompt: ExecutionReport optional-field branches", () => {
  it("omits Checks/Files Changed/Notes/PR Draft Created/Score lines when those fields are absent, but still renders the section from the summary alone", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 3,
      payloadJson: {
        summary: "Minimal report.",
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v3)");
    expect(result).toContain("**Summary:**\nMinimal report.");
    expect(result).not.toContain("**Score:**");
    expect(result).not.toContain("**Checks:**");
    expect(result).not.toContain("**Files Changed");
    expect(result).not.toContain("**Notes:**");
    expect(result).not.toContain("**PR Draft Created:**");
  });

  it("falls back to the artifact's own version when payload.executionVersion is absent", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 7,
      payloadJson: { summary: "No executionVersion field." },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v7)");
  });

  it("omits the entire Execution Report section when every optional field is absent", () => {
    const artifact = makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Execution Report");
  });

  it("renders prDraftCreated: no when explicitly false", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: { summary: "x", prDraftCreated: false },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**PR Draft Created:** no");
  });

  it("renders a '?' status and no em-dash suffix for a check with neither status nor details", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        summary: "x",
        checks: { lint: {}, typecheck: { status: "pass" }, tests: { status: "pass" } },
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**Lint:** ?");
    expect(result).not.toContain("**Lint:** ? —");
  });

  it("stringifies non-string filesChanged/notes entries", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        summary: "x",
        filesChanged: [{ path: "weird.ts" }],
        notes: [{ note: "structured note" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain('{"path":"weird.ts"}');
    expect(result).toContain('{"note":"structured note"}');
  });
});
