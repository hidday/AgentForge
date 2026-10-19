import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import { PolicyViolationError } from "../../src/utils/errors.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "run/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 0,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "summary",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [],
    testPlan: "run the tests",
    confidence: 0.8,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "done",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "Add feature",
      description: "desc",
      labels: [],
      priority: 2,
    },
    repo: {
      name: "widgets",
      defaultBranch: "main",
      workingBranch: "run/run-1",
      repoPath: "/repos/widgets",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secrets/"],
    },
    constraints: {
      requiredChecks: ["lint", "typecheck", "tests"],
      maxFilesChanged: 2,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["tests pass"],
    ...overrides,
  };
}

describe("PolicyEngine.assertCanPlan", () => {
  it("allows planning from Todo", () => {
    const engine = new PolicyEngine();
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning (re-planning after clarification)", () => {
    const engine = new PolicyEngine();
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state", () => {
    const engine = new PolicyEngine();
    try {
      engine.assertCanPlan(makeRun({ state: RunState.Done }));
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  it("passes when implementing, approved, and plan version matches", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).not.toThrow();
  });

  it("rejects when run is not Implementing", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
      expect.objectContaining({ rule: "execute_requires_implementing_state" }),
    );
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
      expect.objectContaining({ rule: "execute_requires_explicit_approval" }),
    );
  });

  it("rejects when there is no plan artifact", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, null)).toThrowError(
      expect.objectContaining({ rule: "execute_requires_plan_artifact" }),
    );
  });

  it("rejects when plan version does not match approved version", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).toThrowError(
      expect.objectContaining({ rule: "execute_plan_version_mismatch" }),
    );
  });
});

describe("PolicyEngine.assertCanReview", () => {
  it("passes when in AIReview with a PR and execution report", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("rejects when run is not in AIReview", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrowError(
      expect.objectContaining({ rule: "review_requires_ai_review_state" }),
    );
  });

  it("rejects when there is no PR", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrowError(
      expect.objectContaining({ rule: "review_requires_pr" }),
    );
  });

  it("rejects when there is no execution report", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    expect(() => engine.assertCanReview(run, null)).toThrowError(
      expect.objectContaining({ rule: "review_requires_execution_report" }),
    );
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const changesRequestedReview = makeReview({
    overallVerdict: "changes_requested",
    findings: [
      {
        id: "f1",
        severity: "blocker",
        type: "bug",
        file: "src/a.ts",
        title: "bug",
        details: "details",
      },
    ],
  });

  it("passes when AddressingReview with changes_requested verdict and findings", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AddressingReview });
    expect(() => engine.assertCanRemediate(run, changesRequestedReview)).not.toThrow();
  });

  it("rejects when run is not in AddressingReview", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AIReview });
    expect(() => engine.assertCanRemediate(run, changesRequestedReview)).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_addressing_review_state" }),
    );
  });

  it("rejects when there is no review artifact", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AddressingReview });
    expect(() => engine.assertCanRemediate(run, null)).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_review" }),
    );
  });

  it("rejects when review verdict is not changes_requested", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AddressingReview });
    expect(() =>
      engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" })),
    ).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_changes_requested_verdict" }),
    );
  });

  it("rejects when review has no findings", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AddressingReview });
    expect(() =>
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [] }),
      ),
    ).toThrowError(expect.objectContaining({ rule: "remediate_requires_findings" }));
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const approvedReview = makeReview({ overallVerdict: "approved", findings: [] });

  it("passes when PR exists, checks are green, and review is approved with no blockers", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    expect(() =>
      engine.assertCanMarkReady(run, approvedReview, makeExecutionReport()),
    ).not.toThrow();
  });

  it("rejects when there is no PR", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: null });
    expect(() =>
      engine.assertCanMarkReady(run, approvedReview, makeExecutionReport()),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_pr" }));
  });

  it("rejects when there is no execution report", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    expect(() => engine.assertCanMarkReady(run, approvedReview, null)).toThrowError(
      expect.objectContaining({ rule: "ready_requires_execution_report" }),
    );
  });

  it("rejects when lint failed", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "lint error" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    expect(() => engine.assertCanMarkReady(run, approvedReview, report)).toThrowError(
      expect.objectContaining({ rule: "ready_requires_green_checks" }),
    );
  });

  it("rejects when typecheck failed", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "type error" },
        tests: { status: "pass", details: "ok" },
      },
    });
    expect(() => engine.assertCanMarkReady(run, approvedReview, report)).toThrowError(
      expect.objectContaining({ rule: "ready_requires_green_checks" }),
    );
  });

  it("rejects when tests failed", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "fail", details: "test failure" },
      },
    });
    expect(() => engine.assertCanMarkReady(run, approvedReview, report)).toThrowError(
      expect.objectContaining({ rule: "ready_requires_green_checks" }),
    );
  });

  it("passes when checks skip rather than fail", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "skip", details: "not configured" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    expect(() => engine.assertCanMarkReady(run, approvedReview, report)).not.toThrow();
  });

  it("rejects when there is no review", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    expect(() => engine.assertCanMarkReady(run, null, makeExecutionReport())).toThrowError(
      expect.objectContaining({ rule: "ready_requires_review" }),
    );
  });

  it("rejects when review verdict is not approved", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    expect(() =>
      engine.assertCanMarkReady(run, review, makeExecutionReport()),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_approved_verdict" }));
  });

  it("rejects when there are unresolved blocker findings", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/a.ts",
          title: "bug",
          details: "details",
        },
        {
          id: "f2",
          severity: "nit",
          type: "style",
          file: "src/b.ts",
          title: "nit",
          details: "details",
        },
      ],
    });
    expect(() =>
      engine.assertCanMarkReady(run, review, makeExecutionReport()),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_blockers_resolved" }));
  });

  it("passes when approved review has only non-blocker findings", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/b.ts",
          title: "nit",
          details: "details",
        },
      ],
    });
    expect(() =>
      engine.assertCanMarkReady(run, review, makeExecutionReport()),
    ).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  it("passes when no protected paths are touched and file count is within limit", () => {
    const engine = new PolicyEngine();
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths(["src/a.ts"], bundle)).not.toThrow();
  });

  it("rejects when a changed file is under a protected path", () => {
    const engine = new PolicyEngine();
    const bundle = makeTaskBundle();
    expect(() =>
      engine.assertExecutorPaths(["src/secrets/key.ts"], bundle),
    ).toThrowError(expect.objectContaining({ rule: "executor_touched_protected_path" }));
  });

  it("rejects when the number of changed files exceeds the configured maximum", () => {
    const engine = new PolicyEngine();
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() =>
      engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
    ).toThrowError(expect.objectContaining({ rule: "executor_exceeded_max_files" }));
  });

  it("passes when the number of changed files equals the configured maximum (boundary)", () => {
    const engine = new PolicyEngine();
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
  });
});
