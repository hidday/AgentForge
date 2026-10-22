import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { Review } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

// These private formatting methods are pure functions of their arguments
// (they never read `this`), so we can invoke them directly via `.call({}, ...)`
// without constructing a full OrchestratorService instance. This exercises
// the exact same production code the service calls when posting Linear
// comments, without needing to drive an entire run lifecycle for each branch.
type Formatters = {
  formatPlanComment(plan: Plan, statusNote?: string): string;
  formatExecutionReportComment(report: ExecutionReport): string;
  formatPlanReviewComment(planReview: PlanReview): string;
  formatPlanRevisionComment(
    dispositions: { findingId: string; status: string; rationale: string }[],
  ): string;
  formatCodeReviewComment(review: Review): string;
  formatRemediationComment(remediation: {
    resolution: { findingId: string; status: string; action: string; rationale: string }[];
    executionReport: { executionVersion: number; score: number; scoreRationale: string };
  }): string;
};

const formatters = OrchestratorService.prototype as unknown as Formatters;

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Add auth middleware",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Add middleware", description: "Create auth.ts" }],
    testPlan: "Run unit tests",
    confidence: 0.85,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the middleware.",
    filesChanged: ["src/auth.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "solid implementation",
    ...overrides,
  };
}

describe("OrchestratorService.formatPlanComment", () => {
  it("renders steps, confidence and status note, omitting questions/risks sections when empty", () => {
    const text = formatters.formatPlanComment(makePlan(), "AI plan review: approved");

    expect(text).toContain("## AI Plan (v1) -- Confidence: 85%");
    expect(text).toContain("*AI plan review: approved*");
    expect(text).toContain("1. **Add middleware**: Create auth.ts");
    expect(text).not.toContain("Open Questions");
    expect(text).not.toContain("Risks");
  });

  it("renders open questions (marking which block execution) and risks when present", () => {
    const plan = makePlan({
      openQuestions: [
        { id: "q1", question: "Which provider?", requiredForExecution: true },
        { id: "q2", question: "Rate limit?", requiredForExecution: false },
      ],
      risks: ["Token leakage"],
    });

    const text = formatters.formatPlanComment(plan);

    expect(text).toContain("**Open Questions:**");
    expect(text).toContain("- Which provider? *blocks execution*");
    expect(text).toContain("- Rate limit?");
    expect(text).not.toContain("Rate limit? *blocks execution*");
    expect(text).toContain("**Risks:**\n- Token leakage");
  });
});

describe("OrchestratorService.formatExecutionReportComment", () => {
  it("omits the files section entirely when no files changed, and the notes section when there are no notes", () => {
    const text = formatters.formatExecutionReportComment(
      makeExecutionReport({ filesChanged: [], notes: [] }),
    );

    expect(text).not.toContain("Files changed");
    expect(text).not.toContain("### Notes");
    expect(text).toContain(":white_check_mark: **Lint**");
  });

  it("renders a flat file list when filesChanged is at or below the collapse threshold (8)", () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/file${i}.ts`);
    const text = formatters.formatExecutionReportComment(makeExecutionReport({ filesChanged: files }));

    expect(text).toContain("### Files changed (8)");
    expect(text).not.toContain("<details>");
    expect(text).toContain("- `src/file0.ts`");
  });

  it("collapses the file list inside <details> when filesChanged exceeds the threshold", () => {
    const files = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const text = formatters.formatExecutionReportComment(makeExecutionReport({ filesChanged: files }));

    expect(text).toContain("<details>");
    expect(text).toContain("<summary><strong>Files changed (9)</strong></summary>");
    expect(text).toContain("</details>");
  });

  it("renders the notes section with each note as a bullet when notes are present", () => {
    const text = formatters.formatExecutionReportComment(
      makeExecutionReport({ notes: ["Skipped flaky e2e test", "Left a TODO in auth.ts"] }),
    );

    expect(text).toContain("### Notes");
    expect(text).toContain("- Skipped flaky e2e test");
    expect(text).toContain("- Left a TODO in auth.ts");
  });

  it("maps each check status to the right icon, including the fail and unknown/other states", () => {
    const text = formatters.formatExecutionReportComment(
      makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "type error" },
          tests: { status: "skipped", details: "n/a" },
        },
      }),
    );

    expect(text).toContain(":white_check_mark: **Lint**");
    expect(text).toContain(":x: **Typecheck**");
    expect(text).toContain(":heavy_minus_sign: **Tests**");
  });
});

describe("OrchestratorService.formatPlanReviewComment", () => {
  it("renders 'Approved' heading and findings, with the step reference omitted when absent", () => {
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Looks solid",
      overallVerdict: "approved",
      findings: [
        { severity: "minor", title: "Naming nit", details: "Rename foo to bar" },
      ],
    };

    const text = formatters.formatPlanReviewComment(planReview);

    expect(text).toContain("## AI Plan Review -- Approved");
    expect(text).toContain("**[MINOR]** Naming nit");
    expect(text).not.toContain("(step");
  });

  it("renders 'Changes Requested' heading and includes the affected step id when present", () => {
    const planReview: PlanReview = {
      reviewId: "pr-2",
      summary: "Needs work",
      overallVerdict: "changes_requested",
      findings: [
        {
          severity: "major",
          title: "Missing validation",
          details: "Validate input",
          affectedStepId: "s1",
        },
      ],
    };

    const text = formatters.formatPlanReviewComment(planReview);

    expect(text).toContain("## AI Plan Review -- Changes Requested");
    expect(text).toContain("(step s1)");
  });
});

describe("OrchestratorService.formatPlanRevisionComment", () => {
  it("renders each disposition with its finding id, status and rationale", () => {
    const text = formatters.formatPlanRevisionComment([
      { findingId: "f1", status: "accepted", rationale: "Valid concern, updated plan" },
      { findingId: "f2", status: "rejected", rationale: "Out of scope for this issue" },
    ]);

    expect(text).toContain("### Plan Revision Dispositions");
    expect(text).toContain("- **f1** [accepted]: Valid concern, updated plan");
    expect(text).toContain("- **f2** [rejected]: Out of scope for this issue");
  });
});

describe("OrchestratorService.formatCodeReviewComment", () => {
  it("renders 'Approved' and omits the line hint when absent", () => {
    const review: Review = {
      reviewId: "rev-1",
      summary: "Clean implementation",
      overallVerdict: "approved",
      findings: [{ severity: "minor", title: "Typo", details: "Fix comment", file: "src/a.ts" }],
    };

    const text = formatters.formatCodeReviewComment(review);

    expect(text).toContain("## AI Code Review -- Approved");
    expect(text).toContain("Typo (src/a.ts)");
    expect(text).not.toContain("src/a.ts:");
  });

  it("renders 'Changes Requested' and includes the line hint when present", () => {
    const review: Review = {
      reviewId: "rev-2",
      summary: "Found an issue",
      overallVerdict: "changes_requested",
      findings: [
        {
          severity: "critical",
          title: "SQL injection",
          details: "Use parameterized queries",
          file: "src/db.ts",
          lineHint: 42,
        },
      ],
    };

    const text = formatters.formatCodeReviewComment(review);

    expect(text).toContain("## AI Code Review -- Changes Requested");
    expect(text).toContain("src/db.ts:42");
  });
});

describe("OrchestratorService.formatRemediationComment", () => {
  it("renders the resolution items and the formatted score line", () => {
    const text = formatters.formatRemediationComment({
      resolution: [
        { findingId: "f1", status: "fixed", action: "Added input validation", rationale: "Prevents injection" },
      ],
      executionReport: { executionVersion: 2, score: 0.875, scoreRationale: "Addressed all findings" },
    });

    expect(text).toContain("## Remediation Summary");
    expect(text).toContain("- **f1** [fixed]: Added input validation");
    expect(text).toContain("*Rationale*: Prevents injection");
    expect(text).toContain("**Implementation score (v2): 0.88 (88%)** -- Addressed all findings");
  });
});
