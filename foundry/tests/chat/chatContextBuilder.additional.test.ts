import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run, Artifact } from "../../src/domain/types.js";

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

describe("buildChatSystemPrompt (Plan openQuestions bullets)", () => {
  it("renders open questions as bullet lines when the Plan artifact includes them", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: ["Should we use OAuth?", { id: "q2", question: "Which region?" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Should we use OAuth?");
    expect(result).toContain(JSON.stringify({ id: "q2", question: "Which region?" }));
  });

  it("omits the Open Questions bullets when the Plan artifact has none", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Plan summary", openQuestions: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).not.toContain("**Open Questions:**");
  });
});

describe("buildChatSystemPrompt (Linear Issue section omission)", () => {
  it("omits the '## Linear Issue' section entirely when title, identifier, and description are all absent", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueDescription: null,
    });
    const result = buildChatSystemPrompt(run, []);
    expect(result).not.toContain("## Linear Issue");
  });

  it("includes the '## Linear Issue' section when only the identifier is present", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: "ENG-7",
      linearIssueDescription: null,
    });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-7");
  });
});

describe("buildChatSystemPrompt (Run metadata optional fields)", () => {
  it("renders '(none)' for branchName and PR Number when they are null", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });
});

describe("buildChatSystemPrompt (PlanReview findings section)", () => {
  it("includes '## Plan Review Findings' with summary and finding lines when present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan looks mostly solid",
        findings: [
          {
            id: "pr1",
            severity: "important",
            title: "Missing rollback step",
            details: "No rollback plan if migration fails",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Plan looks mostly solid");
    expect(result).toContain("[important] Missing rollback step");
    expect(result).toContain("(pr1)");
    expect(result).toContain("No rollback plan if migration fails");
  });

  it("omits the Plan Review Findings section when no PlanReview artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("omits the Plan Review Findings section when summary and findings are both absent", () => {
    const artifact = makeArtifact({ type: "PlanReview", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("renders the summary alone even when findings is empty", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "Only a summary, no findings", findings: [] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Only a summary, no findings");
  });

  it("uses the highest-version PlanReview artifact when multiple exist", () => {
    const v1 = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "Old plan review" },
    });
    const v2 = makeArtifact({
      type: "PlanReview",
      version: 2,
      payloadJson: { summary: "New plan review" },
    });
    const result = buildChatSystemPrompt(makeRun(), [v1, v2]);
    expect(result).toContain("New plan review");
    expect(result).not.toContain("Old plan review");
  });
});

describe("buildChatSystemPrompt (Code Review findings section)", () => {
  it("includes '## Code Review Findings' with summary and finding lines when present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One blocker found",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            title: "Null pointer",
            details: "Will crash on null input",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("One blocker found");
    expect(result).toContain("[blocker] Null pointer");
    expect(result).toContain("(f1)");
    expect(result).toContain("Will crash on null input");
  });

  it("omits the Code Review Findings section when no Review artifact exists", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("omits the Code Review Findings section when summary and findings are both absent", () => {
    const artifact = makeArtifact({ type: "Review", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("renders multiple findings, each on its own bullet line", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Two issues found",
        findings: [
          { id: "f1", severity: "blocker", title: "Issue one", details: "Detail one" },
          { id: "f2", severity: "nit", title: "Issue two", details: "Detail two" },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("[blocker] Issue one");
    expect(result).toContain("[nit] Issue two");
  });

  it("uses the highest-version Review artifact when multiple exist", () => {
    const v1 = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { summary: "Old code review" },
    });
    const v2 = makeArtifact({
      type: "Review",
      version: 2,
      payloadJson: { summary: "New code review" },
    });
    const result = buildChatSystemPrompt(makeRun(), [v1, v2]);
    expect(result).toContain("New code review");
    expect(result).not.toContain("Old code review");
  });
});

describe("buildChatSystemPrompt (fallback branches for missing optional sub-fields)", () => {
  it("falls back to empty-string placeholders for a Plan step missing id/title, and JSON-stringifies non-string risks/assumptions", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        steps: [{}],
        risks: [{ kind: "non-string-risk" }],
        assumptions: [{ kind: "non-string-assumption" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("**** : ");
    expect(result).toContain(JSON.stringify({ kind: "non-string-risk" }));
    expect(result).toContain(JSON.stringify({ kind: "non-string-assumption" }));
  });

  it("falls back to empty strings for HumanAnswers entries missing questionId/answer", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Human Answers");
    expect(result).toContain("**[]:**");
  });

  it("omits the summary line and falls back to empty strings for ResearchedAnswers missing summary/questionId/confidence", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers");
    expect(result).toContain("**[] ():** ");
  });

  it("falls back to empty strings for PlanReview findings missing every optional field", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[] ** (): ");
  });

  it("falls back to empty strings for Review findings missing every optional field", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("**[] ** (): ");
  });

  it("falls back to '?' for a missing check status, JSON-stringifies a non-string file/note, and falls back to the artifact version when executionVersion is absent", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 7,
      payloadJson: {
        summary: "s",
        filesChanged: [{ path: "not-a-string-file" }],
        checks: {
          lint: {},
          typecheck: { status: "pass" },
          tests: { status: "pass" },
        },
        notes: [{ note: "not-a-string-note" }],
        score: 0.5,
        scoreRationale: "r",
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v7)");
    expect(result).toContain("**Lint:** ?");
    expect(result).toContain(JSON.stringify({ path: "not-a-string-file" }));
    expect(result).toContain(JSON.stringify({ note: "not-a-string-note" }));
  });

  it("omits the PR Draft Created line when prDraftCreated is not a boolean", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        executionVersion: 1,
        summary: "s",
        filesChanged: [],
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
        notes: [],
        score: 0.5,
        scoreRationale: "r",
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("PR Draft Created");
  });

  it("falls back to '?' and empty strings for a RejectionContext missing all optional fields", () => {
    const artifact = makeArtifact({ type: "RejectionContext", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Rejection Context(s)");
    expect(result).toContain("**Plan v?** (, ):");
  });

  it("findLatest keeps the current best when a later artifact in the array has a lower version", () => {
    const v2 = makeArtifact({
      type: "Plan",
      version: 2,
      payloadJson: { summary: "Higher version summary" },
    });
    const v1 = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Lower version summary" },
    });
    // v2 appears before v1, so the reduce comparator's "keep best" (false) branch
    // is exercised on the second element.
    const result = buildChatSystemPrompt(makeRun(), [v2, v1]);
    expect(result).toContain("Higher version summary");
    expect(result).not.toContain("Lower version summary");
  });
});
