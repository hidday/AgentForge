import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { Review } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

// These private formatting helpers are exercised indirectly by other
// orchestratorService.*.test.ts files through the public methods that call
// them, but a handful of their branches are only reachable with argument
// shapes the current call sites never produce (e.g. formatPlanReviewComment
// is only ever invoked with overallVerdict "changes_requested" in production
// code; its "approved" display-text branch is otherwise dead). We access the
// private methods directly here, the same way one would unit test any pure
// string-formatting function, purely to close out those remaining branches.
function buildMinimalService() {
  const deps = {
    runRepo: {},
    artifactRepo: {},
    eventRepo: {},
    linearClient: {},
    githubClient: {},
    gitService: {},
    repoRegistry: {},
    linearSync: {},
    githubSync: {},
    plannerAgent: {},
    planReviewerAgent: {},
    planReviserAgent: {},
    executorAgent: {},
    reviewerAgent: {},
    remediationAgent: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
  return new OrchestratorService(deps as never) as unknown as {
    formatPlanComment: (plan: Plan, statusNote?: string) => string;
    formatExecutionReportComment: (report: ExecutionReport) => string;
    formatPlanReviewComment: (planReview: PlanReview) => string;
    formatCodeReviewComment: (review: Review) => string;
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good.",
    ...overrides,
  };
}

describe("OrchestratorService -- formatPlanComment", () => {
  it("omits the status line entirely when no statusNote is given", () => {
    const svc = buildMinimalService();
    const comment = svc.formatPlanComment(makePlan());
    expect(comment).not.toMatch(/\*.*\*\n/);
  });

  it("includes a Risks section when the plan lists risks", () => {
    const svc = buildMinimalService();
    const comment = svc.formatPlanComment(makePlan({ risks: ["Breaking change to the API"] }));
    expect(comment).toContain("**Risks:**");
    expect(comment).toContain("Breaking change to the API");
  });
});

describe("OrchestratorService -- formatExecutionReportComment", () => {
  it("renders the skip icon for a check with status other than pass/fail", () => {
    const svc = buildMinimalService();
    const comment = svc.formatExecutionReportComment(
      makeExecutionReport({ checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "skip", details: "not applicable" },
        tests: { status: "pass", details: "ok" },
      } }),
    );
    expect(comment).toContain(":heavy_minus_sign:");
    expect(comment).toContain("not applicable");
  });

  it("renders the fail icon for a failing check", () => {
    const svc = buildMinimalService();
    const comment = svc.formatExecutionReportComment(
      makeExecutionReport({ checks: {
        lint: { status: "fail", details: "2 lint errors" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      } }),
    );
    expect(comment).toContain(":x:");
    expect(comment).toContain("2 lint errors");
  });
});

describe("OrchestratorService -- formatPlanReviewComment", () => {
  it("renders 'Approved' in the heading when the verdict is approved", () => {
    const svc = buildMinimalService();
    const comment = svc.formatPlanReviewComment({
      reviewId: "pr-1",
      summary: "All good",
      findings: [],
      overallVerdict: "approved",
    });
    expect(comment).toContain("AI Plan Review -- Approved");
  });

  it("omits the step reference when a finding has no affectedStepId", () => {
    const svc = buildMinimalService();
    const comment = svc.formatPlanReviewComment({
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [
        { id: "f1", severity: "nit", type: "style", title: "Nit", details: "minor" },
      ],
      overallVerdict: "changes_requested",
    });
    expect(comment).toContain("**[NIT]** Nit");
    expect(comment).not.toContain("(step ");
  });
});

describe("OrchestratorService -- formatCodeReviewComment", () => {
  it("renders 'Approved' in the heading when the verdict is approved", () => {
    const svc = buildMinimalService();
    const comment = svc.formatCodeReviewComment({
      reviewId: "rev-1",
      summary: "All good",
      findings: [],
      overallVerdict: "approved",
    });
    expect(comment).toContain("AI Code Review -- Approved");
  });

  it("includes the line hint when a finding has one", () => {
    const svc = buildMinimalService();
    const comment = svc.formatCodeReviewComment({
      reviewId: "rev-1",
      summary: "Needs work",
      findings: [
        {
          id: "f1",
          severity: "suggestion",
          type: "style",
          file: "src/x.ts",
          lineHint: 42,
          title: "Nit",
          details: "minor",
        },
      ],
      overallVerdict: "changes_requested",
    });
    expect(comment).toContain("(src/x.ts:42)");
  });

  it("omits the line hint when a finding has no lineHint", () => {
    const svc = buildMinimalService();
    const comment = svc.formatCodeReviewComment({
      reviewId: "rev-1",
      summary: "Needs work",
      findings: [
        { id: "f1", severity: "suggestion", type: "style", file: "src/x.ts", title: "Nit", details: "minor" },
      ],
      overallVerdict: "changes_requested",
    });
    expect(comment).toContain("(src/x.ts)");
    expect(comment).not.toContain("(src/x.ts:");
  });
});
