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

  it("falls back to '(none)' for the branch name and PR number when they are null", () => {
    const run = makeRun({ branchName: null, prNumber: null });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });

  it("renders the branch name and PR number when present", () => {
    const run = makeRun({ branchName: "feature/abc", prNumber: 7 });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("**Branch:** feature/abc");
    expect(result).toContain("**PR Number:** 7");
  });

  it("returns a string containing the Linear issue title when present", () => {
    const run = makeRun({ linearIssueTitle: "Feature XYZ" });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("Feature XYZ");
  });

  it("omits the Linear Issue section entirely when title, identifier and description are all absent", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: null,
      linearIssueDescription: null,
    });
    const result = buildChatSystemPrompt(run, []);
    expect(result).not.toContain("## Linear Issue");
  });

  it("renders only the Identifier line when title and description are absent", () => {
    const run = makeRun({
      linearIssueTitle: null,
      linearIssueIdentifier: "ENG-42",
      linearIssueDescription: null,
    });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-42");
    expect(result).not.toContain("**Title:**");
    expect(result).not.toContain("**Description:**");
  });

  it("renders only the Title line when identifier and description are absent", () => {
    const run = makeRun({
      linearIssueTitle: "Feature XYZ",
      linearIssueIdentifier: null,
      linearIssueDescription: null,
    });
    const result = buildChatSystemPrompt(run, []);
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Title:** Feature XYZ");
    expect(result).not.toContain("**Identifier:**");
    expect(result).not.toContain("**Description:**");
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

  it("falls back to empty strings for step id/title/description and JSON-stringifies non-string risks/assumptions", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        steps: [{}],
        risks: [{ code: "R1" }],
        assumptions: [{ code: "A1" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("**Steps:**");
    // Step with no id/title/description still renders a line with empty fallbacks.
    expect(result).toContain("  - **** : ");
    expect(result).toContain(JSON.stringify({ code: "R1" }));
    expect(result).toContain(JSON.stringify({ code: "A1" }));
  });

  it("omits the Current Plan section entirely when the Plan payload has no renderable fields", () => {
    const planArtifact = makeArtifact({ type: "Plan", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).not.toContain("## Current Plan");
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

  it("falls back to empty strings when a human answer is missing questionId/answer", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Human Answers");
    expect(result).toContain("  - **[]:** ");
  });

  it("omits the Human Answers section when the HumanAnswers artifact has no answers", () => {
    const artifact = makeArtifact({ type: "HumanAnswers", version: 1, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Human Answers");
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

  it("omits Researched Answers section when the artifact has no answers", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: { summary: "Nothing to report." },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Researched Answers");
  });

  it("falls back to empty strings when a researched answer is missing questionId/confidence/answer", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers");
    expect(result).toContain("  - **[] ():** ");
  });

  it("renders Researched Answers without a summary line when summary is absent", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: {
        answers: [{ questionId: "q1", answer: "A.", confidence: "low" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers");
    expect(result).toContain("[q1] (low)");
    expect(result).not.toContain("**Summary:**");
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

  it("falls back to '?' and empty strings for RejectionContext fields that are missing", () => {
    const artifact = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Rejection Context(s)");
    expect(result).toContain("**Plan v?** (, ):");
  });

  it("renders every RejectionContext artifact when multiple are present", () => {
    const a1 = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: { planVersion: 1, feedback: "First rejection", source: "api", mode: "iterate" },
    });
    const a2 = makeArtifact({
      type: "RejectionContext",
      version: 1,
      payloadJson: { planVersion: 2, feedback: "Second rejection", source: "dashboard", mode: "restart" },
    });
    const result = buildChatSystemPrompt(makeRun(), [a1, a2]);
    expect(result).toContain("First rejection");
    expect(result).toContain("Second rejection");
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

  it("omits the Execution Report section entirely when the payload has no renderable fields", () => {
    const artifact = makeArtifact({ type: "ExecutionReport", version: 3, payloadJson: {} });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Execution Report");
  });

  it("falls back to '?' status and omits the details suffix for checks missing those fields, and uses the artifact version when executionVersion is absent", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 5,
      payloadJson: {
        checks: {
          lint: {},
          typecheck: { status: "pass" },
          tests: { status: "pass", details: "all good" },
        },
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v5)");
    expect(result).toContain("**Lint:** ?");
    expect(result).toContain("**Typecheck:** pass");
    expect(result).not.toContain("**Typecheck:** pass —");
    expect(result).toContain("**Tests:** pass — all good");
  });

  it("JSON-stringifies non-string entries in filesChanged and notes", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        filesChanged: [{ path: "src/foo.ts", status: "modified" }],
        notes: [{ kind: "warning", text: "Skipped a check" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain(
      "`" + JSON.stringify({ path: "src/foo.ts", status: "modified" }) + "`",
    );
    expect(result).toContain(JSON.stringify({ kind: "warning", text: "Skipped a check" }));
  });

  it("includes plan open questions when the Plan artifact has them", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        openQuestions: ["Should we support SSO?", { id: "q2", question: "Rate limits?" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Should we support SSO?");
    expect(result).toContain(JSON.stringify({ id: "q2", question: "Rate limits?" }));
  });

  it("includes plan review findings section when a PlanReview artifact is present", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "Plan looks mostly solid.",
        findings: [
          {
            id: "pf1",
            severity: "important",
            title: "Missing rollback plan",
            details: "No mention of how to roll back the migration.",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("Plan looks mostly solid.");
    expect(result).toContain("[important] Missing rollback plan");
    expect(result).toContain("No mention of how to roll back the migration.");
  });

  it("falls back to empty strings when a plan review finding is missing severity/title/id/details", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("  - **[] ** (): ");
  });

  it("omits the plan review findings section when the PlanReview payload has no summary or findings", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("omits the plan review findings section when no PlanReview artifact is present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes code review findings section when a Review artifact is present", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "Found one blocker.",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            title: "Null pointer risk",
            details: "foo can be null here.",
          },
        ],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("Found one blocker.");
    expect(result).toContain("[blocker] Null pointer risk");
    expect(result).toContain("foo can be null here.");
  });

  it("falls back to empty strings when a code review finding is missing severity/title/id/details", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("  - **[] ** (): ");
  });

  it("omits the code review findings section when the Review payload has no summary or findings", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {},
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).not.toContain("## Code Review Findings");
  });

  it("omits the code review findings section when no Review artifact is present", () => {
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

  it("keeps the current best version when a later artifact's version is lower (findLatest reduce)", () => {
    const planV1 = makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "v1 summary" } });
    const planV3 = makeArtifact({ type: "Plan", version: 3, payloadJson: { summary: "v3 summary" } });
    const planV2 = makeArtifact({ type: "Plan", version: 2, payloadJson: { summary: "v2 summary" } });
    // Order: v1, v3, v2 — after v3 becomes "best", comparing v2 must hit the
    // reduce's false branch (cur.version > best.version is false) and keep v3.
    const result = buildChatSystemPrompt(makeRun(), [planV1, planV3, planV2]);
    expect(result).toContain("v3 summary");
    expect(result).not.toContain("v1 summary");
    expect(result).not.toContain("v2 summary");
  });
});
