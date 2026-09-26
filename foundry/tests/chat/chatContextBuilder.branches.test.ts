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

describe("buildChatSystemPrompt — run metadata fallbacks", () => {
  it("renders '(none)' for a null branchName and a null prNumber", () => {
    const result = buildChatSystemPrompt(makeRun({ branchName: null, prNumber: null }), []);
    expect(result).toContain("**Branch:** (none)");
    expect(result).toContain("**PR Number:** (none)");
  });
});

describe("buildChatSystemPrompt — Linear issue section trigger combinations", () => {
  it("omits the Linear Issue section when title, identifier, and description are all absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueDescription: null }),
      [],
    );
    expect(result).not.toContain("## Linear Issue");
  });

  it("renders the section from the identifier alone when title and description are absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({ linearIssueTitle: null, linearIssueIdentifier: "ENG-7", linearIssueDescription: null }),
      [],
    );
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Identifier:** ENG-7");
    expect(result).not.toContain("**Title:**");
    expect(result).not.toContain("**Description:**");
  });

  it("renders the section from the description alone when title and identifier are absent", () => {
    const result = buildChatSystemPrompt(
      makeRun({
        linearIssueTitle: null,
        linearIssueIdentifier: null,
        linearIssueDescription: "Only a description",
      }),
      [],
    );
    expect(result).toContain("## Linear Issue");
    expect(result).toContain("**Description:**\nOnly a description");
    expect(result).not.toContain("**Identifier:**");
    expect(result).not.toContain("**Title:**");
  });
});

describe("buildChatSystemPrompt — additional branch coverage", () => {
  it("includes the Plan's open questions section when the Plan artifact has openQuestions", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "Plan summary",
        steps: [],
        openQuestions: [{ id: "q1", question: "Should we cache?", requiredForExecution: true }],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);

    expect(result).toContain("## Current Plan");
    expect(result).toContain("**Open Questions:**");
    expect(result).toContain("Should we cache?");
  });

  it("includes the Plan Review Findings section when a PlanReview artifact is present", () => {
    const planReviewArtifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: {
        summary: "The plan looks mostly solid.",
        findings: [
          {
            id: "f1",
            severity: "important",
            title: "Missing rollback",
            details: "No rollback plan for the migration.",
          },
        ],
      },
    });

    const result = buildChatSystemPrompt(makeRun(), [planReviewArtifact]);

    expect(result).toContain("## Plan Review Findings");
    expect(result).toContain("The plan looks mostly solid.");
    expect(result).toContain("**[important] Missing rollback** (f1): No rollback plan for the migration.");
  });

  it("omits the Plan Review Findings section when no PlanReview artifact is present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Plan Review Findings");
  });

  it("includes the Code Review Findings section when a Review artifact is present", () => {
    const reviewArtifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: {
        summary: "One blocker found.",
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

    const result = buildChatSystemPrompt(makeRun(), [reviewArtifact]);

    expect(result).toContain("## Code Review Findings");
    expect(result).toContain("One blocker found.");
    expect(result).toContain("**[blocker] Null pointer risk** (f1): foo can be null here.");
  });

  it("omits the Code Review Findings section when no Review artifact is present", () => {
    const result = buildChatSystemPrompt(makeRun(), []);
    expect(result).not.toContain("## Code Review Findings");
  });
});

describe("buildChatSystemPrompt — plan steps/risks/assumptions/openQuestions field fallbacks", () => {
  it("falls back to empty strings for a step missing id/title/description", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "s", steps: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("  - **** : ");
  });

  it("JSON-stringifies a non-string risk and a non-string assumption", () => {
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

  it("renders a plain-string risk/assumption/openQuestion as-is (no JSON.stringify)", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "s",
        risks: ["A plain risk"],
        assumptions: ["A plain assumption"],
        openQuestions: ["A plain open question"],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain("  - A plain risk");
    expect(result).toContain("  - A plain assumption");
    expect(result).toContain("  - A plain open question");
  });

  it("JSON-stringifies a non-string open question object", () => {
    const planArtifact = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: {
        summary: "s",
        openQuestions: [{ id: "q1", question: "Structured?" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
    expect(result).toContain(JSON.stringify({ id: "q1", question: "Structured?" }));
  });
});

describe("buildChatSystemPrompt — HumanAnswers field fallbacks", () => {
  it("falls back to empty strings when a human answer is missing questionId/answer", () => {
    const artifact = makeArtifact({
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("  - **[]:** ");
  });
});

describe("buildChatSystemPrompt — ResearchedAnswers field fallbacks", () => {
  it("falls back to empty strings for a missing questionId/confidence/answer, and omits the summary line when absent", () => {
    const artifact = makeArtifact({
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: { answers: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Researched Answers (AI best-effort, not authoritative)");
    expect(result).toContain("  - **[] ():** ");
    // No summary field was provided, so the "**Summary:**" line is omitted.
    expect(result).not.toContain("**Summary:**\n");
  });
});

describe("buildChatSystemPrompt — PlanReview finding field fallbacks", () => {
  it("falls back to empty strings for a PlanReview finding missing severity/title/id/details", () => {
    const artifact = makeArtifact({
      type: "PlanReview",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("  - **[] ** (): ");
  });
});

describe("buildChatSystemPrompt — Review (code review) finding field fallbacks", () => {
  it("falls back to empty strings for a Review finding missing severity/title/id/details", () => {
    const artifact = makeArtifact({
      type: "Review",
      version: 1,
      payloadJson: { findings: [{}] },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("  - **[] ** (): ");
  });
});

describe("buildChatSystemPrompt — ExecutionReport field fallbacks", () => {
  it("falls back to '?' for a missing check's status and omits the details separator when absent", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 4,
      payloadJson: {
        score: 0.5,
        checks: {},
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("- **Lint:** ?");
    expect(result).toContain("- **Typecheck:** ?");
    expect(result).toContain("- **Tests:** ?");
  });

  it("JSON-stringifies a non-string filesChanged entry and a non-string note", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        score: 0.5,
        filesChanged: [{ path: "src/foo.ts" }],
        notes: [{ note: "structured note" }],
      },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain(JSON.stringify({ path: "src/foo.ts" }));
    expect(result).toContain(JSON.stringify({ note: "structured note" }));
  });

  it("falls back to the artifact's own version when executionVersion is absent from the payload", () => {
    const artifact = makeArtifact({
      type: "ExecutionReport",
      version: 7,
      payloadJson: { score: 0.5 },
    });
    const result = buildChatSystemPrompt(makeRun(), [artifact]);
    expect(result).toContain("## Execution Report (v7)");
  });
});

describe("buildChatSystemPrompt — RejectionContext field fallbacks", () => {
  it("falls back to '?' / empty strings when a RejectionContext payload has no fields", () => {
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

describe("buildChatSystemPrompt — findLatest picks the highest version regardless of array order", () => {
  it("uses the highest-versioned artifact even when it appears first in the array", () => {
    const planV2 = makeArtifact({
      type: "Plan",
      version: 2,
      payloadJson: { summary: "Newer summary" },
    });
    const planV1 = makeArtifact({
      type: "Plan",
      version: 1,
      payloadJson: { summary: "Older summary" },
    });
    const result = buildChatSystemPrompt(makeRun(), [planV2, planV1]);
    expect(result).toContain("Newer summary");
    expect(result).not.toContain("Older summary");
  });
});
