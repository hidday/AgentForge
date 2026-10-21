import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function expectPolicyViolation(fn: () => void, rule: string): void {
  expect.assertions(2);
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe(rule);
    return;
  }
  throw new Error(`Expected fn to throw a PolicyViolationError with rule "${rule}"`);
}

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
    summary: "summary",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [],
    testPlan: "",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "done",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 1,
    scoreRationale: "",
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

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test",
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
      protectedPaths: ["infra/", ".github/"],
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
  const engine = new PolicyEngine();

  it("allows planning from Todo", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning (re-entrant)", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Implementing }))).toThrow(
      PolicyViolationError,
    );
    try {
      engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("allows execution when implementing, approved, and plan version matches", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
  });

  it("rejects when not in Implementing state", () => {
    const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    expectPolicyViolation(
      () => engine.assertCanExecute(run, makePlan()),
      "execute_requires_implementing_state",
    );
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    expectPolicyViolation(
      () => engine.assertCanExecute(run, makePlan()),
      "execute_requires_explicit_approval",
    );
  });

  it("rejects when there is no plan artifact", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    expectPolicyViolation(
      () => engine.assertCanExecute(run, null),
      "execute_requires_plan_artifact",
    );
  });

  it("rejects when plan version does not match the approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 3 });
    expectPolicyViolation(
      () => engine.assertCanExecute(run, plan),
      "execute_plan_version_mismatch",
    );
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("allows review when in AIReview with a PR and an execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("rejects when not in AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
    expectPolicyViolation(
      () => engine.assertCanReview(run, makeExecutionReport()),
      "review_requires_ai_review_state",
    );
  });

  it("rejects when there is no PR number", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    expectPolicyViolation(
      () => engine.assertCanReview(run, makeExecutionReport()),
      "review_requires_pr",
    );
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    expectPolicyViolation(
      () => engine.assertCanReview(run, null),
      "review_requires_execution_report",
    );
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("allows remediation when AddressingReview with a changes_requested review with findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
  });

  it("rejects when not in AddressingReview state", () => {
    const run = makeRun({ state: RunState.AIReview });
    expectPolicyViolation(
      () => engine.assertCanRemediate(run, makeReview()),
      "remediate_requires_addressing_review_state",
    );
  });

  it("rejects when there is no review artifact", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    expectPolicyViolation(
      () => engine.assertCanRemediate(run, null),
      "remediate_requires_review",
    );
  });

  it("rejects when the review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "approved" });
    expectPolicyViolation(
      () => engine.assertCanRemediate(run, review),
      "remediate_requires_changes_requested_verdict",
    );
  });

  it("rejects when there are no findings to remediate", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    expectPolicyViolation(
      () => engine.assertCanRemediate(run, review),
      "remediate_requires_findings",
    );
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();

  it("allows marking ready when PR exists, checks are green, and review is approved with no blockers", () => {
    const run = makeRun({ prNumber: 42 });
    expect(() =>
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
    ).not.toThrow();
  });

  it("rejects when there is no PR", () => {
    const run = makeRun({ prNumber: null });
    expectPolicyViolation(
      () => engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
      "ready_requires_pr",
    );
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ prNumber: 42 });
    expectPolicyViolation(
      () => engine.assertCanMarkReady(run, makeReview(), null),
      "ready_requires_execution_report",
    );
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when the %s check failed",
    (checkName) => {
      const run = makeRun({ prNumber: 42 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
          [checkName]: { status: "fail", details: "boom" },
        },
      });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, makeReview(), report),
        "ready_requires_green_checks",
      );
    },
  );

  it("rejects when there is no review", () => {
    const run = makeRun({ prNumber: 42 });
    expectPolicyViolation(
      () => engine.assertCanMarkReady(run, null, makeExecutionReport()),
      "ready_requires_review",
    );
  });

  it("rejects when the review verdict is not approved", () => {
    const run = makeRun({ prNumber: 42 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    expectPolicyViolation(
      () => engine.assertCanMarkReady(run, review, makeExecutionReport()),
      "ready_requires_approved_verdict",
    );
  });

  it("rejects when there are unresolved blocker findings even if verdict is approved", () => {
    const run = makeRun({ prNumber: 42 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
      ],
    });
    try {
      engine.assertCanMarkReady(run, review, makeExecutionReport());
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      expect((err as PolicyViolationError).message).toContain("1 unresolved blocker");
    }
  });

  it("allows marking ready when findings exist but none are blockers", () => {
    const run = makeRun({ prNumber: 42 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" },
      ],
    });
    expect(() =>
      engine.assertCanMarkReady(run, review, makeExecutionReport()),
    ).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("allows changes within the file-count limit and outside protected paths", () => {
    const bundle = makeBundle();
    expect(() =>
      engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
    ).not.toThrow();
  });

  it("rejects when any changed file is under a protected path", () => {
    const bundle = makeBundle();
    expectPolicyViolation(
      () => engine.assertExecutorPaths(["infra/terraform.tf"], bundle),
      "executor_touched_protected_path",
    );
  });

  it("checks protected paths by prefix, not exact match", () => {
    const bundle = makeBundle({
      repo: { ...makeBundle().repo, protectedPaths: [".github/"] },
    });
    expectPolicyViolation(
      () => engine.assertExecutorPaths([".github/workflows/ci.yml"], bundle),
      "executor_touched_protected_path",
    );
  });

  it("allows exactly the maximum number of files changed (boundary)", () => {
    const bundle = makeBundle({
      constraints: { ...makeBundle().constraints, maxFilesChanged: 2 },
    });
    expect(() =>
      engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
    ).not.toThrow();
  });

  it("rejects when one more file than the maximum is changed (boundary)", () => {
    const bundle = makeBundle({
      constraints: { ...makeBundle().constraints, maxFilesChanged: 2 },
    });
    expectPolicyViolation(
      () => engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      "executor_exceeded_max_files",
    );
  });

  it("checks protected paths before the file-count limit", () => {
    const bundle = makeBundle({
      constraints: { ...makeBundle().constraints, maxFilesChanged: 100 },
    });
    try {
      engine.assertExecutorPaths(["infra/terraform.tf"], bundle);
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
    }
  });
});
