import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
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
    summary: "Implementation done.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All green.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: ["secrets/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 3,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
    ...overrides,
  };
}

describe("PolicyEngine.assertCanPlan", () => {
  const policy = new PolicyEngine();

  it("allows planning from Todo", () => {
    expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows (re)planning from Planning", () => {
    expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("throws PolicyViolationError with rule plan_requires_todo_or_planning_state for any other state", () => {
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanPlan(makeRun({ state: RunState.Implementing }));
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("plan_requires_todo_or_planning_state");
    expect(caught?.message).toContain("Implementing");
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const policy = new PolicyEngine();

  it("throws when run is not Implementing", () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanExecute(run, makePlan({ planVersion: 1 }));
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("execute_requires_implementing_state");
  });

  it("throws when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanExecute(run, makePlan({ planVersion: 1 }));
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("execute_requires_explicit_approval");
  });

  it("throws when plan is null", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanExecute(run, null);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("execute_requires_plan_artifact");
  });

  it("throws when plan version does not match approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanExecute(run, makePlan({ planVersion: 1 }));
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("execute_plan_version_mismatch");
    expect(caught?.message).toContain("v1");
    expect(caught?.message).toContain("v2");
  });

  it("passes when Implementing, approved, and plan version matches", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
    expect(() => policy.assertCanExecute(run, makePlan({ planVersion: 3 }))).not.toThrow();
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const policy = new PolicyEngine();

  it("throws when run is not AIReview", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanReview(run, makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_ai_review_state");
  });

  it("throws when there is no PR number", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanReview(run, makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_pr");
  });

  it("throws when there is no execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanReview(run, null);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_execution_report");
  });

  it("passes when AIReview, PR exists, and execution report exists", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const policy = new PolicyEngine();

  it("throws when run is not AddressingReview", () => {
    const run = makeRun({ state: RunState.AIReview });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_addressing_review_state");
  });

  it("throws when there is no review", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanRemediate(run, null);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_review");
  });

  it("throws when review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_changes_requested_verdict");
  });

  it("throws when review has no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanRemediate(run, review);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_findings");
  });

  it("passes when AddressingReview, review present, verdict changes_requested, and findings exist", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/foo.ts",
          title: "Bug",
          details: "Something is wrong",
        },
      ],
    });
    expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const policy = new PolicyEngine();

  it("throws when there is no PR number", () => {
    const run = makeRun({ prNumber: null });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, makeReview(), makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_pr");
  });

  it("throws when there is no execution report", () => {
    const run = makeRun({ prNumber: 5 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, makeReview(), null);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_execution_report");
  });

  it("throws when lint check failed", () => {
    const run = makeRun({ prNumber: 5 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "lint error" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, makeReview(), report);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_green_checks");
  });

  it("throws when typecheck failed", () => {
    const run = makeRun({ prNumber: 5 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "type error" },
        tests: { status: "pass", details: "ok" },
      },
    });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, makeReview(), report);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_green_checks");
  });

  it("throws when tests failed", () => {
    const run = makeRun({ prNumber: 5 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "fail", details: "test error" },
      },
    });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, makeReview(), report);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_green_checks");
  });

  it("passes when checks are 'skip' (not 'fail')", () => {
    const run = makeRun({ prNumber: 5 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "skip", details: "skipped" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    expect(() => policy.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
  });

  it("throws when there is no review", () => {
    const run = makeRun({ prNumber: 5 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, null, makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_review");
  });

  it("throws when review verdict is not approved", () => {
    const run = makeRun({ prNumber: 5 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, review, makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_approved_verdict");
  });

  it("throws when there are unresolved blocker findings even with an approved verdict", () => {
    const run = makeRun({ prNumber: 5 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/foo.ts",
          title: "Blocking bug",
          details: "Must fix",
        },
      ],
    });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, review, makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_blockers_resolved");
    expect(caught?.message).toContain("1");
  });

  it("passes when PR exists, checks are green, review approved, and no blocker findings", () => {
    const run = makeRun({ prNumber: 5 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Nit",
          details: "Minor style issue",
        },
      ],
    });
    expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const policy = new PolicyEngine();

  it("throws executor_touched_protected_path when a changed file starts with a protected path", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp",
        allowedPaths: ["src/"],
        protectedPaths: ["secrets/"],
      },
    });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertExecutorPaths(["src/foo.ts", "secrets/keys.json"], bundle);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("executor_touched_protected_path");
    expect(caught?.message).toContain("secrets/keys.json");
  });

  it("throws executor_exceeded_max_files when file count exceeds the max", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("executor_exceeded_max_files");
    expect(caught?.message).toContain("3");
    expect(caught?.message).toContain("2");
  });

  it("passes when file count is exactly at the max (boundary, not exceeding)", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() => policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
  });

  it("passes with an empty diff (no files changed)", () => {
    const bundle = makeTaskBundle();
    expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
  });

  it("does not flag a file that merely contains, but does not start with, a protected path segment", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp",
        allowedPaths: ["src/"],
        protectedPaths: ["secrets/"],
      },
    });
    // "src/not-secrets/file.ts" does not start with "secrets/"
    expect(() =>
      policy.assertExecutorPaths(["src/not-secrets/file.ts"], bundle),
    ).not.toThrow();
  });

  it("checks protected paths before the max-files-changed limit (protected-path violation reported first)", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp",
        allowedPaths: ["src/"],
        protectedPaths: ["secrets/"],
      },
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 1,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertExecutorPaths(["src/a.ts", "secrets/b.ts"], bundle);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("executor_touched_protected_path");
  });
});
