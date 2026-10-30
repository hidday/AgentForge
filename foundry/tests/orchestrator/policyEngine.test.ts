import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
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
    latestArtifactVersion: 0,
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

function makeCheck(status: "pass" | "fail" | "skip" = "pass") {
  return { status, details: "" };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Executed",
    filesChanged: [],
    checks: {
      lint: makeCheck(),
      typecheck: makeCheck(),
      tests: makeCheck(),
    },
    notes: [],
    prDraftCreated: false,
    score: 0.9,
    scoreRationale: "good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
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
      protectedPaths: ["secrets/"],
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

describe("PolicyEngine", () => {
  describe("assertCanPlan", () => {
    it("does not throw when run is Todo", () => {
      const policy = new PolicyEngine();
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("does not throw when run is Planning", () => {
      const policy = new PolicyEngine();
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws PolicyViolationError with the right rule for any other state", () => {
      const policy = new PolicyEngine();
      try {
        policy.assertCanPlan(makeRun({ state: RunState.AwaitingPlanApproval }));
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as Error).message).toContain("AwaitingPlanApproval");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("does not throw when state is Implementing, approval matches plan version, and plan exists", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => policy.assertCanExecute(run, plan)).not.toThrow();
    });

    it("throws execute_requires_implementing_state when not Implementing", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 2 });
      expect(() => policy.assertCanExecute(run, makePlan({ planVersion: 2 }))).toThrowError(
        expect.objectContaining({ rule: "execute_requires_implementing_state" }),
      );
    });

    it("throws execute_requires_explicit_approval when approvedPlanVersion is null", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      expect(() => policy.assertCanExecute(run, makePlan())).toThrowError(
        expect.objectContaining({ rule: "execute_requires_explicit_approval" }),
      );
    });

    it("throws execute_requires_plan_artifact when plan is null", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect(() => policy.assertCanExecute(run, null)).toThrowError(
        expect.objectContaining({ rule: "execute_requires_plan_artifact" }),
      );
    });

    it("throws execute_plan_version_mismatch when plan version differs from approvedPlanVersion", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 3 });
      try {
        policy.assertCanExecute(run, plan);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as Error).message).toContain("v3");
        expect((err as Error).message).toContain("v2");
      }
    });
  });

  describe("assertCanReview", () => {
    it("does not throw when state is AIReview, prNumber set, and execution report present", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("throws review_requires_ai_review_state when not AIReview", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "review_requires_ai_review_state" }),
      );
    });

    it("throws review_requires_pr when prNumber is missing", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "review_requires_pr" }),
      );
    });

    it("throws review_requires_execution_report when executionReport is null", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => policy.assertCanReview(run, null)).toThrowError(
        expect.objectContaining({ rule: "review_requires_execution_report" }),
      );
    });
  });

  describe("assertCanRemediate", () => {
    it("does not throw when state is AddressingReview with changes_requested and findings", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
    });

    it("throws remediate_requires_addressing_review_state when not AddressingReview", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.AIReview });
      expect(() => policy.assertCanRemediate(run, makeReview())).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_addressing_review_state" }),
      );
    });

    it("throws remediate_requires_review when review is null", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => policy.assertCanRemediate(run, null)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_review" }),
      );
    });

    it("throws remediate_requires_changes_requested_verdict when verdict is approved", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      try {
        policy.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
        expect((err as Error).message).toContain("approved");
      }
    });

    it("throws remediate_requires_findings when findings array is empty", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect(() => policy.assertCanRemediate(run, review)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_findings" }),
      );
    });
  });

  describe("assertCanMarkReady", () => {
    it("does not throw when PR exists, checks pass, and review is approved with no blockers", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ prNumber: 9 });
      expect(() =>
        policy.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
      ).not.toThrow();
    });

    it("throws ready_requires_pr when prNumber is missing", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ prNumber: null });
      expect(() =>
        policy.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
      ).toThrowError(expect.objectContaining({ rule: "ready_requires_pr" }));
    });

    it("throws ready_requires_execution_report when executionReport is null", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ prNumber: 9 });
      expect(() => policy.assertCanMarkReady(run, makeReview(), null)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_execution_report" }),
      );
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "throws ready_requires_green_checks when %s fails",
      (check) => {
        const policy = new PolicyEngine();
        const run = makeRun({ prNumber: 9 });
        const report = makeExecutionReport({
          checks: {
            lint: makeCheck(),
            typecheck: makeCheck(),
            tests: makeCheck(),
            [check]: makeCheck("fail"),
          },
        });
        expect(() => policy.assertCanMarkReady(run, makeReview(), report)).toThrowError(
          expect.objectContaining({ rule: "ready_requires_green_checks" }),
        );
      },
    );

    it("throws ready_requires_review when review is null", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ prNumber: 9 });
      expect(() => policy.assertCanMarkReady(run, null, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_review" }),
      );
    });

    it("throws ready_requires_approved_verdict when latest review verdict is not approved", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ prNumber: 9 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
        expect((err as Error).message).toContain("changes_requested");
      }
    });

    it("throws ready_requires_blockers_resolved when there are unresolved blocker findings", () => {
      const policy = new PolicyEngine();
      const run = makeRun({ prNumber: 9 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
          { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
        ],
      });
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as Error).message).toContain("1 unresolved blocker");
      }
    });
  });

  describe("assertExecutorPaths", () => {
    it("does not throw when no protected paths touched and file count is within limit", () => {
      const policy = new PolicyEngine();
      expect(() =>
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], makeTaskBundle()),
      ).not.toThrow();
    });

    it("throws executor_touched_protected_path when a changed file starts with a protected path", () => {
      const policy = new PolicyEngine();
      const bundle = makeTaskBundle();
      try {
        policy.assertExecutorPaths(["secrets/key.pem"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as Error).message).toContain("secrets/key.pem");
      }
    });

    it("throws executor_exceeded_max_files when filesChanged exceeds maxFilesChanged", () => {
      const policy = new PolicyEngine();
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as Error).message).toContain("3 files");
      }
    });

    it("checks protected paths before the file-count limit when both conditions are met", () => {
      const policy = new PolicyEngine();
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        policy.assertExecutorPaths(["secrets/key.pem", "src/a.ts"], bundle),
      ).toThrowError(expect.objectContaining({ rule: "executor_touched_protected_path" }));
    });
  });
});
