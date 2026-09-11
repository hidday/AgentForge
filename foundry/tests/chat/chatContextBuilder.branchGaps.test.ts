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

describe("buildChatSystemPrompt: run metadata fallback branches", () => {
  it("falls back to '(none)' when branchName is null", () => {
    const prompt = buildChatSystemPrompt(makeRun({ branchName: null }), []);
    expect(prompt).toContain("**Branch:** (none)");
  });

  it("falls back to '(none)' when prNumber is null", () => {
    const prompt = buildChatSystemPrompt(makeRun({ prNumber: null }), []);
    expect(prompt).toContain("**PR Number:** (none)");
  });

  it("omits the Linear Issue section entirely when title, identifier, and description are all absent", () => {
    const prompt = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueDescription: null }),
      [],
    );
    expect(prompt).not.toContain("## Linear Issue");
  });
});

describe("buildChatSystemPrompt: Current Plan field-level fallbacks", () => {
  it("falls back to empty strings for missing step id/title/description, and JSON.stringify for non-string risks/assumptions/openQuestions", () => {
    const plan = makeArtifact({
      type: "Plan",
      payloadJson: {
        steps: [{}],
        risks: [{ risk: "non-string risk object" }],
        assumptions: [{ assumption: "non-string assumption object" }],
        openQuestions: [{ id: "q1", question: "non-string open question object" }],
      },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [plan]);

    expect(prompt).toContain("  - **** : ");
    expect(prompt).toContain(JSON.stringify({ risk: "non-string risk object" }));
    expect(prompt).toContain(JSON.stringify({ assumption: "non-string assumption object" }));
    expect(prompt).toContain(
      JSON.stringify({ id: "q1", question: "non-string open question object" }),
    );
  });

  it("renders a plain-string open question as-is, without JSON.stringify", () => {
    const plan = makeArtifact({
      type: "Plan",
      payloadJson: { openQuestions: ["Should we use JWT or sessions?"] },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [plan]);

    expect(prompt).toContain("  - Should we use JWT or sessions?");
  });
});

describe("buildChatSystemPrompt: Human Answers field-level fallbacks", () => {
  it("falls back to empty strings for a Human Answer missing questionId/answer", () => {
    const humanAnswers = makeArtifact({
      type: "HumanAnswers",
      payloadJson: { answers: [{}] },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [humanAnswers]);

    expect(prompt).toContain("## Human Answers");
    expect(prompt).toContain("  - **[]:** ");
  });
});

describe("buildChatSystemPrompt: Researched Answers field-level fallbacks", () => {
  it("falls back to empty strings for a missing questionId/confidence/answer and omits summary/sources when absent", () => {
    const researched = makeArtifact({
      type: "ResearchedAnswers",
      payloadJson: { answers: [{}] },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [researched]);

    expect(prompt).toContain("## Researched Answers");
    expect(prompt).toContain("  - **[] ():** ");
    expect(prompt).not.toContain("_(sources:");
    // No summary field, so the summary line should not appear before the answer bullet.
    expect(prompt).not.toContain("**Summary:**\n-");
  });
});

describe("buildChatSystemPrompt: Plan Review / Code Review field-level fallbacks", () => {
  it("falls back to empty strings for missing finding severity/title/id/details in Plan Review", () => {
    const planReview = makeArtifact({
      type: "PlanReview",
      payloadJson: { findings: [{}] },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [planReview]);

    expect(prompt).toContain("## Plan Review Findings");
    expect(prompt).toContain("  - **[] ** (): ");
  });

  it("falls back to empty strings for missing finding severity/title/id/details in Code Review", () => {
    const review = makeArtifact({
      type: "Review",
      payloadJson: { findings: [{}] },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [review]);

    expect(prompt).toContain("## Code Review Findings");
    expect(prompt).toContain("  - **[] ** (): ");
  });
});

describe("buildChatSystemPrompt: Execution Report field-level fallbacks", () => {
  it("falls back to '?' status and omits the details suffix when a check is entirely missing", () => {
    const execReport = makeArtifact({
      type: "ExecutionReport",
      payloadJson: { checks: {} },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [execReport]);

    expect(prompt).toContain("**Lint:** ?");
    expect(prompt).toContain("**Typecheck:** ?");
    expect(prompt).toContain("**Tests:** ?");
    // No " — " suffix should appear for a check with no details.
    expect(prompt).not.toMatch(/\?\s+—/);
  });

  it("appends the details suffix when a check has a status and details", () => {
    const execReport = makeArtifact({
      type: "ExecutionReport",
      payloadJson: { checks: { lint: { status: "fail", details: "2 errors" } } },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [execReport]);

    expect(prompt).toContain("**Lint:** fail — 2 errors");
  });

  it("uses JSON.stringify for non-string filesChanged/notes entries", () => {
    const execReport = makeArtifact({
      type: "ExecutionReport",
      payloadJson: {
        filesChanged: [{ path: "src/weird.ts" }],
        notes: [{ note: "structured note" }],
      },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [execReport]);

    expect(prompt).toContain(JSON.stringify({ path: "src/weird.ts" }));
    expect(prompt).toContain(JSON.stringify({ note: "structured note" }));
  });

  it("falls back to the artifact's own version when executionVersion is absent from the payload", () => {
    const execReport = makeArtifact({
      type: "ExecutionReport",
      version: 7,
      payloadJson: { summary: "Did the work." },
    });

    const prompt = buildChatSystemPrompt(makeRun(), [execReport]);

    expect(prompt).toContain("## Execution Report (v7)");
  });
});

describe("buildChatSystemPrompt: Rejection Context field-level fallbacks", () => {
  it("falls back to '?' plan version and empty strings for source/mode/feedback when absent", () => {
    const rejection = makeArtifact({ type: "RejectionContext", payloadJson: {} });

    const prompt = buildChatSystemPrompt(makeRun(), [rejection]);

    expect(prompt).toContain("## Rejection Context(s)");
    expect(prompt).toContain("  - **Plan v?** (, ): ");
  });
});

describe("buildChatSystemPrompt: findLatest picks the highest version in either array order", () => {
  it("picks the higher-versioned artifact when the higher version comes last", () => {
    const v1 = makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "old plan" } });
    const v2 = makeArtifact({ type: "Plan", version: 2, payloadJson: { summary: "new plan" } });

    const prompt = buildChatSystemPrompt(makeRun(), [v1, v2]);

    expect(prompt).toContain("new plan");
    expect(prompt).not.toContain("old plan");
  });

  it("picks the higher-versioned artifact when the higher version comes first", () => {
    const v2 = makeArtifact({ type: "Plan", version: 2, payloadJson: { summary: "new plan" } });
    const v1 = makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "old plan" } });

    const prompt = buildChatSystemPrompt(makeRun(), [v2, v1]);

    expect(prompt).toContain("new plan");
    expect(prompt).not.toContain("old plan");
  });
});
