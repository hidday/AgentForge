import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { Review, Finding } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/foo.ts",
    title: "Finding title",
    details: "Finding details",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "Review summary",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Execution summary",
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "rationale",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "Issue title",
      description: "Issue description",
      labels: [],
      priority: 2,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "feature/x",
      repoPath: "/repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/generated/", ".github/"],
    },
    constraints: {
      requiredChecks: ["lint", "test"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["All tests pass"],
    ...overrides,
  };
}

function expectPolicyViolation(fn: () => void, expectedCode: string): void {
  expect(fn).toThrow(PolicyViolationError);
  try {
    fn();
    throw new Error("expected fn to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe(expectedCode);
  }
}

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning when run is Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning when run is already Planning", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws plan_requires_todo_or_planning_state for any other state", () => {
      expectPolicyViolation(
        () => engine.assertCanPlan(makeRun({ state: RunState.Implementing })),
        "plan_requires_todo_or_planning_state",
      );
    });
  });

  describe("assertCanExecute", () => {
    it("allows execution when state is Implementing, plan is approved and versions match", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });

    it("throws execute_requires_implementing_state when run is not Implementing", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      expectPolicyViolation(
        () => engine.assertCanExecute(run, makePlan({ planVersion: 1 })),
        "execute_requires_implementing_state",
      );
    });

    it("throws execute_requires_explicit_approval when approvedPlanVersion is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      expectPolicyViolation(
        () => engine.assertCanExecute(run, makePlan()),
        "execute_requires_explicit_approval",
      );
    });

    it("throws execute_requires_plan_artifact when plan is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expectPolicyViolation(() => engine.assertCanExecute(run, null), "execute_requires_plan_artifact");
    });

    it("throws execute_plan_version_mismatch when plan version differs from approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 3 });
      expectPolicyViolation(
        () => engine.assertCanExecute(run, plan),
        "execute_plan_version_mismatch",
      );
    });
  });

  describe("assertCanReview", () => {
    it("allows review when state is AIReview, prNumber set and executionReport present", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("throws review_requires_ai_review_state when run is not AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
      expectPolicyViolation(
        () => engine.assertCanReview(run, makeExecutionReport()),
        "review_requires_ai_review_state",
      );
    });

    it("throws review_requires_pr when prNumber is not set", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expectPolicyViolation(
        () => engine.assertCanReview(run, makeExecutionReport()),
        "review_requires_pr",
      );
    });

    it("throws review_requires_execution_report when executionReport is null", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      expectPolicyViolation(
        () => engine.assertCanReview(run, null),
        "review_requires_execution_report",
      );
    });
  });

  describe("assertCanRemediate", () => {
    it("allows remediation when state is AddressingReview, verdict is changes_requested and findings exist", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });

    it("throws remediate_requires_addressing_review_state when run is not AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      expectPolicyViolation(
        () => engine.assertCanRemediate(run, review),
        "remediate_requires_addressing_review_state",
      );
    });

    it("throws remediate_requires_review when review is null", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expectPolicyViolation(
        () => engine.assertCanRemediate(run, null),
        "remediate_requires_review",
      );
    });

    it("throws remediate_requires_changes_requested_verdict when verdict is approved", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved", findings: [makeFinding()] });
      expectPolicyViolation(
        () => engine.assertCanRemediate(run, review),
        "remediate_requires_changes_requested_verdict",
      );
    });

    it("throws remediate_requires_findings when there are no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expectPolicyViolation(
        () => engine.assertCanRemediate(run, review),
        "remediate_requires_findings",
      );
    });
  });

  describe("assertCanMarkReady", () => {
    it("allows marking ready when PR exists, checks are green, review approved and no blockers", () => {
      const run = makeRun({ prNumber: 42 });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
      ).not.toThrow();
    });

    it("throws ready_requires_pr when prNumber is not set", () => {
      const run = makeRun({ prNumber: null });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
        "ready_requires_pr",
      );
    });

    it("throws ready_requires_execution_report when executionReport is null", () => {
      const run = makeRun({ prNumber: 42 });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, makeReview(), null),
        "ready_requires_execution_report",
      );
    });

    it("throws ready_requires_green_checks when lint fails", () => {
      const run = makeRun({ prNumber: 42 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "bad" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, makeReview(), report),
        "ready_requires_green_checks",
      );
    });

    it("throws ready_requires_green_checks when typecheck fails", () => {
      const run = makeRun({ prNumber: 42 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "bad" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, makeReview(), report),
        "ready_requires_green_checks",
      );
    });

    it("throws ready_requires_green_checks when tests fail", () => {
      const run = makeRun({ prNumber: 42 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "bad" },
        },
      });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, makeReview(), report),
        "ready_requires_green_checks",
      );
    });

    it("throws ready_requires_review when review is null", () => {
      const run = makeRun({ prNumber: 42 });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, null, makeExecutionReport()),
        "ready_requires_review",
      );
    });

    it("throws ready_requires_approved_verdict when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 42 });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, review, makeExecutionReport()),
        "ready_requires_approved_verdict",
      );
    });

    it("throws ready_requires_blockers_resolved when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 42 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "blocker" }), makeFinding({ severity: "nit" })],
      });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, review, makeExecutionReport()),
        "ready_requires_blockers_resolved",
      );
    });

    it("allows marking ready when findings exist but none are blockers", () => {
      const run = makeRun({ prNumber: 42 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "nit" }), makeFinding({ severity: "suggestion" })],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows changes within allowed paths and under the max files limit", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths(["src/foo.ts", "src/bar.ts"], bundle)).not.toThrow();
    });

    it("throws executor_touched_protected_path when a changed file starts with a protected path", () => {
      const bundle = makeTaskBundle();
      expectPolicyViolation(
        () => engine.assertExecutorPaths(["src/generated/client.ts"], bundle),
        "executor_touched_protected_path",
      );
    });

    it("throws executor_exceeded_max_files when the number of changed files exceeds the limit", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expectPolicyViolation(
        () => engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
        "executor_exceeded_max_files",
      );
    });

    it("allows exactly the maximum number of changed files", () => {
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
});
