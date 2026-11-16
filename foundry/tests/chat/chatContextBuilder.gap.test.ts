import { describe, it, expect } from "vitest";
import { buildChatSystemPrompt } from "../../src/chat/chatContextBuilder.js";
import type { Run } from "../../src/domain/types.js";
import type { Artifact } from "../../src/domain/types.js";

// This file covers gaps left by tests/chat/chatContextBuilder.test.ts:
// - run metadata fallbacks (branchName/prNumber nullish)
// - Linear issue section fully omitted when title/identifier/description are all falsy
// - Plan section: step id/title/description fallbacks, non-string risks/assumptions,
//   and the openQuestions loop (string vs. object entries)
// - Human Answers field fallbacks
// - Researched Answers without a summary line and with missing answer fields
// - PlanReview ("Plan Review Findings") section, present and omitted-when-empty
// - Review ("Code Review Findings") section, present and omitted-when-empty
// - Execution Report: non-string filesChanged/notes entries, executionVersion fallback
// - Rejection Context with all optional fields absent
// - findLatest() reduce branch where an earlier artifact already has the highest version

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

describe("buildChatSystemPrompt gap coverage", () => {
  describe("run metadata fallbacks", () => {
    it("renders '(none)' for branchName and prNumber when both are null", () => {
      const result = buildChatSystemPrompt(makeRun({ branchName: null, prNumber: null }), []);
      expect(result).toContain("**Branch:** (none)");
      expect(result).toContain("**PR Number:** (none)");
    });
  });

  describe("Linear issue section", () => {
    it("is omitted entirely when title, identifier, and description are all falsy", () => {
      const result = buildChatSystemPrompt(
        makeRun({ linearIssueTitle: null, linearIssueIdentifier: null, linearIssueDescription: null }),
        [],
      );
      expect(result).not.toContain("## Linear Issue");
    });
  });

  describe("Plan section edge cases", () => {
    it("falls back to empty strings for missing step id/title/description and stringifies non-string risks/assumptions", () => {
      const planArtifact = makeArtifact({
        type: "Plan",
        version: 3,
        payloadJson: {
          summary: "Plan summary",
          steps: [{}],
          risks: [{ risk: "object risk" }],
          assumptions: [{ assumption: "object assumption" }],
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
      expect(result).toContain("## Current Plan (v3)");
      expect(result).toContain('  - **** :');
      expect(result).toContain(JSON.stringify({ risk: "object risk" }));
      expect(result).toContain(JSON.stringify({ assumption: "object assumption" }));
    });

    it("renders openQuestions with both string and object entries", () => {
      const planArtifact = makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: {
          summary: "Plan summary",
          openQuestions: ["A plain string question?", { id: "q2", question: "Structured?" }],
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [planArtifact]);
      expect(result).toContain("**Open Questions:**");
      expect(result).toContain("A plain string question?");
      expect(result).toContain(JSON.stringify({ id: "q2", question: "Structured?" }));
    });
  });

  describe("Human Answers field fallbacks", () => {
    it("renders empty strings when questionId/answer are missing", () => {
      const artifact = makeArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{}] },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Human Answers");
      expect(result).toContain("  - **[]:** ");
    });
  });

  describe("Researched Answers edge cases", () => {
    it("omits the summary line when payload.summary is absent", () => {
      const artifact = makeArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: {
          answers: [{ questionId: "q1", answer: "A.", confidence: "low" }],
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Researched Answers (AI best-effort, not authoritative)");
      expect(result).not.toContain("**Summary:**");
    });

    it("falls back to empty strings when questionId/confidence/answer are missing", () => {
      const artifact = makeArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: {
          answers: [{}],
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("  - **[] ():** ");
    });
  });

  describe("Plan Review Findings section", () => {
    it("renders summary and findings when a PlanReview artifact is present", () => {
      const artifact = makeArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: {
          summary: "Mostly solid.",
          findings: [{ id: "f1", severity: "medium", title: "Edge case", details: "Handle nulls." }],
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Plan Review Findings");
      expect(result).toContain("**Summary:** Mostly solid.");
      expect(result).toContain("**[medium] Edge case** (f1): Handle nulls.");
    });

    it("falls back to empty strings for findings missing severity/title/id/details", () => {
      const artifact = makeArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { findings: [{}] },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("  - **[] ** (): ");
    });

    it("is omitted when the PlanReview artifact has neither summary nor findings", () => {
      const artifact = makeArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { findings: [] },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).not.toContain("## Plan Review Findings");
    });
  });

  describe("Code Review Findings section", () => {
    it("renders summary and findings when a Review artifact is present", () => {
      const artifact = makeArtifact({
        type: "Review",
        version: 1,
        payloadJson: {
          summary: "Looks good overall.",
          findings: [{ id: "r1", severity: "low", title: "Nit", details: "Naming." }],
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Code Review Findings");
      expect(result).toContain("**Summary:** Looks good overall.");
      expect(result).toContain("**[low] Nit** (r1): Naming.");
    });

    it("falls back to empty strings for findings missing severity/title/id/details", () => {
      const artifact = makeArtifact({
        type: "Review",
        version: 1,
        payloadJson: { findings: [{}] },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("  - **[] ** (): ");
    });

    it("is omitted when the Review artifact has neither summary nor findings", () => {
      const artifact = makeArtifact({
        type: "Review",
        version: 1,
        payloadJson: {},
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).not.toContain("## Code Review Findings");
    });
  });

  describe("Execution Report edge cases", () => {
    it("stringifies non-string filesChanged/notes entries and falls back to artifact.version when executionVersion is absent", () => {
      const artifact = makeArtifact({
        type: "ExecutionReport",
        version: 4,
        payloadJson: {
          filesChanged: [{ path: "src/foo.ts" }],
          notes: [{ note: "structured note" }],
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Execution Report (v4)");
      expect(result).toContain(`\`${JSON.stringify({ path: "src/foo.ts" })}\``);
      expect(result).toContain(JSON.stringify({ note: "structured note" }));
    });

    it("omits the ' — details' suffix on a check line when details is empty", () => {
      const artifact = makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: {
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
          },
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("**Lint:** pass");
      expect(result).not.toContain("**Lint:** pass —");
    });

    it("renders '?' for a check status when the check object itself is missing", () => {
      const artifact = makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: {
          checks: {
            lint: { status: "pass", details: "ok" },
            // typecheck intentionally omitted
            tests: { status: "pass", details: "ok" },
          },
        },
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("**Typecheck:** ?");
    });
  });

  describe("Rejection Context with all optional fields absent", () => {
    it("falls back to '?' and empty strings for planVersion/source/mode/feedback", () => {
      const artifact = makeArtifact({
        type: "RejectionContext",
        version: 1,
        payloadJson: {},
      });
      const result = buildChatSystemPrompt(makeRun(), [artifact]);
      expect(result).toContain("## Rejection Context(s)");
      expect(result).toContain("**Plan v?** (, ):");
    });
  });

  describe("findLatest() reduce branch", () => {
    it("keeps the earlier artifact when a later one in the array has a lower version", () => {
      const planV2First = makeArtifact({
        type: "Plan",
        version: 2,
        payloadJson: { summary: "Kept summary (v2)" },
      });
      const planV1Second = makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: { summary: "Discarded summary (v1)" },
      });
      const result = buildChatSystemPrompt(makeRun(), [planV2First, planV1Second]);
      expect(result).toContain("## Current Plan (v2)");
      expect(result).toContain("Kept summary (v2)");
      expect(result).not.toContain("Discarded summary (v1)");
    });
  });
});
