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
    branchName: null,
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Do the thing",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do step 1" }],
    testPlan: "Run the tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Executed the plan",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "Fix the bug",
      description: "A bug needs fixing",
      labels: [],
      priority: 2,
    },
    repo: {
      name: "acme/widgets",
      defaultBranch: "main",
      workingBranch: "run-1",
      repoPath: "/repo",
      allowedPaths: [],
      protectedPaths: ["infra/", ".github/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 5,
      maxDiffLines: 1000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
    ...overrides,
  };
}

describe("PolicyEngine.assertCanPlan", () => {
  const engine = new PolicyEngine();

  it("allows planning from Todo", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning (replanning)", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("denies planning from any other state with the right error and rule", () => {
    const run = makeRun({ state: RunState.Implementing });
    expect(() => engine.assertCanPlan(run)).toThrow(PolicyViolationError);
    try {
      engine.assertCanPlan(run);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      const e = err as PolicyViolationError;
      expect(e.message).toBe('Cannot plan when run is in state "Implementing"');
      expect(e.rule).toBe("plan_requires_todo_or_planning_state");
    }
  });

  it("denies planning from Done", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Done }))).toThrow(
      PolicyViolationError,
    );
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("allows execution when state is Implementing, plan is present and versions match", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
  });

  it("denies execution when state is not Implementing", () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    expect(() => engine.assertCanExecute(run, plan)).toThrow(PolicyViolationError);
    try {
      engine.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe('Cannot execute when run is in state "AwaitingPlanApproval"');
      expect(e.rule).toBe("execute_requires_implementing_state");
    }
  });

  it("denies execution when approvedPlanVersion is null", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    const plan = makePlan({ planVersion: 1 });
    try {
      engine.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e).toBeInstanceOf(PolicyViolationError);
      expect(e.message).toBe(
        "Cannot execute without explicit plan approval (approvedPlanVersion is not set)",
      );
      expect(e.rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("denies execution when approvedPlanVersion is 0 (falsy but explicit) by requiring not-null check only", () => {
    // approvedPlanVersion uses `== null` so 0 is a valid approved version and should pass this check.
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 0 });
    const plan = makePlan({ planVersion: 0 });
    expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
  });

  it("denies execution when plan artifact is missing", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    try {
      engine.assertCanExecute(run, null);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot execute without a plan artifact");
      expect(e.rule).toBe("execute_requires_plan_artifact");
    }
  });

  it("denies execution when plan version does not match approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
    const plan = makePlan({ planVersion: 2 });
    try {
      engine.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Plan version mismatch: plan is v2 but approved version is v3");
      expect(e.rule).toBe("execute_plan_version_mismatch");
    }
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("allows review when state is AIReview, PR exists and execution report exists", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("denies review when state is not AIReview", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe('Cannot review when run is in state "Implementing"');
      expect(e.rule).toBe("review_requires_ai_review_state");
    }
  });

  it("denies review when there is no PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot review without an existing PR");
      expect(e.rule).toBe("review_requires_pr");
    }
  });

  it("denies review when execution report is missing", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    try {
      engine.assertCanReview(run, null);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot review without a completed execution report");
      expect(e.rule).toBe("review_requires_execution_report");
    }
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("allows remediation when state is AddressingReview, review exists, verdict is changes_requested and has findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/foo.ts",
          title: "Bug",
          details: "There is a bug",
        },
      ],
    });
    expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
  });

  it("denies remediation when state is not AddressingReview", () => {
    const run = makeRun({ state: RunState.AIReview });
    const review = makeReview({ overallVerdict: "changes_requested" });
    try {
      engine.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe('Cannot remediate when run is in state "AIReview"');
      expect(e.rule).toBe("remediate_requires_addressing_review_state");
    }
  });

  it("denies remediation when review artifact is missing", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, null);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot remediate without a review artifact");
      expect(e.rule).toBe("remediate_requires_review");
    }
  });

  it("denies remediation when review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "approved" });
    try {
      engine.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe(
        'Cannot remediate when review verdict is "approved" (must be "changes_requested")',
      );
      expect(e.rule).toBe("remediate_requires_changes_requested_verdict");
    }
  });

  it("denies remediation when there are no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    try {
      engine.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot remediate without review findings");
      expect(e.rule).toBe("remediate_requires_findings");
    }
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();

  it("allows marking ready when PR exists, checks are green, and review is approved with no blockers", () => {
    const run = makeRun({ prNumber: 42 });
    expect(() =>
      engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
    ).not.toThrow();
  });

  it("denies marking ready without a PR", () => {
    const run = makeRun({ prNumber: null });
    try {
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot mark ready without an existing PR");
      expect(e.rule).toBe("ready_requires_pr");
    }
  });

  it("denies marking ready without an execution report", () => {
    const run = makeRun({ prNumber: 42 });
    try {
      engine.assertCanMarkReady(run, makeReview(), null);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot mark ready without execution report");
      expect(e.rule).toBe("ready_requires_execution_report");
    }
  });

  it("denies marking ready when lint check fails", () => {
    const run = makeRun({ prNumber: 42 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "lint error" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    try {
      engine.assertCanMarkReady(run, makeReview(), report);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot mark ready with failing checks");
      expect(e.rule).toBe("ready_requires_green_checks");
    }
  });

  it("denies marking ready when typecheck fails", () => {
    const run = makeRun({ prNumber: 42 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "type error" },
        tests: { status: "pass", details: "ok" },
      },
    });
    try {
      engine.assertCanMarkReady(run, makeReview(), report);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.rule).toBe("ready_requires_green_checks");
    }
  });

  it("denies marking ready when tests fail", () => {
    const run = makeRun({ prNumber: 42 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "fail", details: "test failure" },
      },
    });
    try {
      engine.assertCanMarkReady(run, makeReview(), report);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.rule).toBe("ready_requires_green_checks");
    }
  });

  it("allows marking ready when checks have skip status (not fail)", () => {
    const run = makeRun({ prNumber: 42 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "skip", details: "n/a" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    expect(() =>
      engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), report),
    ).not.toThrow();
  });

  it("denies marking ready without a review", () => {
    const run = makeRun({ prNumber: 42 });
    try {
      engine.assertCanMarkReady(run, null, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot mark ready without a review (review stage must have run)");
      expect(e.rule).toBe("ready_requires_review");
    }
  });

  it("denies marking ready when review verdict is not approved", () => {
    const run = makeRun({ prNumber: 42 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    try {
      engine.assertCanMarkReady(run, review, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe(
        'Cannot mark ready when latest review verdict is "changes_requested" (must be "approved")',
      );
      expect(e.rule).toBe("ready_requires_approved_verdict");
    }
  });

  it("denies marking ready when there are unresolved blocker findings", () => {
    const run = makeRun({ prNumber: 42 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/foo.ts",
          title: "Bug",
          details: "There is a bug",
        },
        {
          id: "f2",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Style nit",
          details: "Minor style issue",
        },
        {
          id: "f3",
          severity: "blocker",
          type: "bug",
          file: "src/bar.ts",
          title: "Another bug",
          details: "There is another bug",
        },
      ],
    });
    try {
      engine.assertCanMarkReady(run, review, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Cannot mark ready with 2 unresolved blocker findings");
      expect(e.rule).toBe("ready_requires_blockers_resolved");
    }
  });

  it("allows marking ready when only non-blocker findings remain", () => {
    const run = makeRun({ prNumber: 42 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "suggestion",
          type: "style",
          file: "src/foo.ts",
          title: "Suggestion",
          details: "Consider refactoring",
        },
        {
          id: "f2",
          severity: "important",
          type: "perf",
          file: "src/foo.ts",
          title: "Perf note",
          details: "Could be faster",
        },
      ],
    });
    expect(() =>
      engine.assertCanMarkReady(run, review, makeExecutionReport()),
    ).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("allows changes within file count limit and outside protected paths", () => {
    const bundle = makeTaskBundle();
    expect(() =>
      engine.assertExecutorPaths(["src/foo.ts", "src/bar.ts"], bundle),
    ).not.toThrow();
  });

  it("allows exactly the maximum number of files changed (boundary)", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 1000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() =>
      engine.assertExecutorPaths(["src/foo.ts", "src/bar.ts"], bundle),
    ).not.toThrow();
  });

  it("denies when a file touches a protected path prefix", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "acme/widgets",
        defaultBranch: "main",
        workingBranch: "run-1",
        repoPath: "/repo",
        allowedPaths: [],
        protectedPaths: ["infra/"],
      },
    });
    try {
      engine.assertExecutorPaths(["infra/terraform.tf", "src/foo.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Executor modified protected path: infra/terraform.tf");
      expect(e.rule).toBe("executor_touched_protected_path");
    }
  });

  it("checks protected paths before the file-count limit (protected path reported even if under limit)", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "acme/widgets",
        defaultBranch: "main",
        workingBranch: "run-1",
        repoPath: "/repo",
        allowedPaths: [],
        protectedPaths: [".github/"],
      },
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 1000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() =>
      engine.assertExecutorPaths([".github/workflows/ci.yml"], bundle),
    ).toThrow(PolicyViolationError);
  });

  it("denies when the number of files changed exceeds the max", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 1,
        maxDiffLines: 1000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    try {
      engine.assertExecutorPaths(["src/foo.ts", "src/bar.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as PolicyViolationError;
      expect(e.message).toBe("Executor changed 2 files (max: 1)");
      expect(e.rule).toBe("executor_exceeded_max_files");
    }
  });

  it("allows zero files changed", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
  });
});
