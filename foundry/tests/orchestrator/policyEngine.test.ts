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
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work/run-1",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "a plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "step 1", description: "do it" }],
    testPlan: "run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "did the work",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "solid",
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

function expectRule(fn: () => void, rule: string): void {
  try {
    fn();
    expect.fail(`expected a PolicyViolationError with rule "${rule}" to be thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe(rule);
  }
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "Fix the bug",
      description: "desc",
      labels: [],
      priority: 2,
    },
    repo: {
      name: "acme/repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/work/run-1",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secrets/"],
    },
    constraints: {
      requiredChecks: ["lint", "test"],
      maxFilesChanged: 5,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["tests pass"],
    ...overrides,
  };
}

describe("PolicyEngine.assertCanPlan", () => {
  const engine = new PolicyEngine();

  it("allows planning from Todo", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state", () => {
    expectRule(
      () => engine.assertCanPlan(makeRun({ state: RunState.Implementing })),
      "plan_requires_todo_or_planning_state",
    );
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("allows execution when state is Implementing, plan approved and versions match", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
  });

  it("rejects when state is not Implementing", () => {
    const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    expectRule(() => engine.assertCanExecute(run, makePlan()), "execute_requires_implementing_state");
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    expectRule(() => engine.assertCanExecute(run, makePlan()), "execute_requires_explicit_approval");
  });

  it("rejects when there is no plan artifact", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    expectRule(() => engine.assertCanExecute(run, null), "execute_requires_plan_artifact");
  });

  it("rejects when the plan version does not match the approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const plan = makePlan({ planVersion: 2 });
    expectRule(() => engine.assertCanExecute(run, plan), "execute_plan_version_mismatch");
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("allows review when state is AIReview, a PR exists, and an execution report exists", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("rejects when state is not AIReview", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
    expectRule(() => engine.assertCanReview(run, makeExecutionReport()), "review_requires_ai_review_state");
  });

  it("rejects when there is no PR number", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    expectRule(() => engine.assertCanReview(run, makeExecutionReport()), "review_requires_pr");
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expectRule(() => engine.assertCanReview(run, null), "review_requires_execution_report");
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("allows remediation when state matches, review exists, verdict is changes_requested, and findings exist", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
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
    expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
  });

  it("rejects when state is not AddressingReview", () => {
    const run = makeRun({ state: RunState.AIReview });
    expectRule(
      () => engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" })),
      "remediate_requires_addressing_review_state",
    );
  });

  it("rejects when there is no review", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    expectRule(() => engine.assertCanRemediate(run, null), "remediate_requires_review");
  });

  it("rejects when the review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "approved" });
    expectRule(() => engine.assertCanRemediate(run, review), "remediate_requires_changes_requested_verdict");
  });

  it("rejects when there are no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    expectRule(() => engine.assertCanRemediate(run, review), "remediate_requires_findings");
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();

  it("allows marking ready when PR exists, checks are green, and review is approved with no blockers", () => {
    const run = makeRun({ prNumber: 7 });
    expect(() =>
      engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
    ).not.toThrow();
  });

  it("rejects when there is no PR", () => {
    const run = makeRun({ prNumber: null });
    expectRule(
      () => engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
      "ready_requires_pr",
    );
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ prNumber: 7 });
    expectRule(() => engine.assertCanMarkReady(run, makeReview(), null), "ready_requires_execution_report");
  });

  it("rejects when lint check failed", () => {
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "broken" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    expectRule(() => engine.assertCanMarkReady(run, makeReview(), report), "ready_requires_green_checks");
  });

  it("rejects when typecheck failed", () => {
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "broken" },
        tests: { status: "pass", details: "ok" },
      },
    });
    expectRule(() => engine.assertCanMarkReady(run, makeReview(), report), "ready_requires_green_checks");
  });

  it("rejects when tests failed", () => {
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "fail", details: "broken" },
      },
    });
    expectRule(() => engine.assertCanMarkReady(run, makeReview(), report), "ready_requires_green_checks");
  });

  it("rejects when there is no review", () => {
    const run = makeRun({ prNumber: 7 });
    expectRule(() => engine.assertCanMarkReady(run, null, makeExecutionReport()), "ready_requires_review");
  });

  it("rejects when review verdict is not approved", () => {
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    expectRule(
      () => engine.assertCanMarkReady(run, review, makeExecutionReport()),
      "ready_requires_approved_verdict",
    );
  });

  it("rejects when there are unresolved blocker findings, even with an approved verdict", () => {
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
          file: "src/a.ts",
          title: "nit",
          details: "details",
        },
      ],
    });
    expectRule(
      () => engine.assertCanMarkReady(run, review, makeExecutionReport()),
      "ready_requires_blockers_resolved",
    );
  });

  it("allows marking ready with non-blocker findings", () => {
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "suggestion",
          type: "style",
          file: "src/a.ts",
          title: "suggestion",
          details: "details",
        },
      ],
    });
    expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("allows changes within the file limit that don't touch protected paths", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
  });

  it("allows exactly maxFilesChanged files (boundary)", () => {
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

  it("rejects one file over the limit (boundary)", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expectRule(
      () => engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      "executor_exceeded_max_files",
    );
  });

  it("rejects a change under a protected path prefix", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "acme/repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/work/run-1",
        allowedPaths: ["src/"],
        protectedPaths: ["src/secrets/"],
      },
    });
    expectRule(
      () => engine.assertExecutorPaths(["src/secrets/keys.ts"], bundle),
      "executor_touched_protected_path",
    );
  });

  it("does not throw for an empty diff (no files changed)", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
  });
});
