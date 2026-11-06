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
    branchName: null,
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
    summary: "Implemented",
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
    reviewId: "rev-1",
    summary: "Fine",
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
      description: "desc",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: ["infra/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 5,
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

  it("allows planning from Planning (retry case)", () => {
    expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state with the correct rule code", () => {
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

  it("rejects when run is not Implementing", () => {
    const run = makeRun({ state: RunState.PlanReview, approvedPlanVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanExecute(run, plan);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("execute_requires_implementing_state");
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    const plan = makePlan({ planVersion: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanExecute(run, plan);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("execute_requires_explicit_approval");
  });

  it("rejects when plan artifact is missing (null)", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanExecute(run, null);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("execute_requires_plan_artifact");
  });

  it("rejects when plan version does not match approvedPlanVersion", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 3 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanExecute(run, plan);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("execute_plan_version_mismatch");
    expect(caught?.message).toContain("v3");
    expect(caught?.message).toContain("v2");
  });

  it("allows execution when Implementing, approved, and plan version matches", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => policy.assertCanExecute(run, plan)).not.toThrow();
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const policy = new PolicyEngine();

  it("rejects when run is not AIReview", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanReview(run, makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_ai_review_state");
  });

  it("rejects when run has no PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanReview(run, makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_pr");
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanReview(run, null);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("review_requires_execution_report");
  });

  it("allows review when AIReview, has PR, and execution report exists", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const policy = new PolicyEngine();

  it("rejects when run is not AddressingReview", () => {
    const run = makeRun({ state: RunState.AIReview });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_addressing_review_state");
  });

  it("rejects when review artifact is missing", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanRemediate(run, null);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_review");
  });

  it("rejects when review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_changes_requested_verdict");
  });

  it("rejects when review has no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [] }),
      );
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("remediate_requires_findings");
  });

  it("allows remediation when AddressingReview, review exists, changes_requested, and has findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const policy = new PolicyEngine();

  it("rejects when run has no PR", () => {
    const run = makeRun({ prNumber: null });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, makeReview(), makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_pr");
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ prNumber: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, makeReview(), null);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_execution_report");
  });

  it("rejects when lint check failed", () => {
    const run = makeRun({ prNumber: 1 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "broken" },
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

  it("rejects when typecheck failed", () => {
    const run = makeRun({ prNumber: 1 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "broken" },
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

  it("rejects when tests failed", () => {
    const run = makeRun({ prNumber: 1 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "fail", details: "broken" },
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

  it("allows checks that are merely skipped (not failed)", () => {
    const run = makeRun({ prNumber: 1 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "skip", details: "n/a" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    expect(() => policy.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
  });

  it("rejects when there is no review", () => {
    const run = makeRun({ prNumber: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, null, makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_review");
  });

  it("rejects when review verdict is not approved", () => {
    const run = makeRun({ prNumber: 1 });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(
        run,
        makeReview({ overallVerdict: "changes_requested" }),
        makeExecutionReport(),
      );
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_approved_verdict");
  });

  it("rejects when there are unresolved blocker findings even if verdict is approved", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
      ],
    });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertCanMarkReady(run, review, makeExecutionReport());
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("ready_requires_blockers_resolved");
    expect(caught?.message).toContain("1 unresolved blocker");
  });

  it("allows marking ready when PR exists, checks green, review approved, no blockers", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
      ],
    });
    expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const policy = new PolicyEngine();

  it("rejects when a changed file starts with a protected path", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp",
        allowedPaths: ["src/"],
        protectedPaths: ["infra/"],
      },
    });
    let caught: PolicyViolationError | undefined;
    try {
      policy.assertExecutorPaths(["src/foo.ts", "infra/terraform.tf"], bundle);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("executor_touched_protected_path");
    expect(caught?.message).toContain("infra/terraform.tf");
  });

  it("rejects when more files changed than maxFilesChanged allows", () => {
    const bundle = makeTaskBundle({
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
      policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle);
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("executor_exceeded_max_files");
    expect(caught?.message).toContain("2 files");
    expect(caught?.message).toContain("max: 1");
  });

  it("allows when no protected paths touched and within maxFilesChanged", () => {
    const bundle = makeTaskBundle();
    expect(() =>
      policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
    ).not.toThrow();
  });

  it("allows an empty filesChanged list", () => {
    const bundle = makeTaskBundle();
    expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
  });
});
