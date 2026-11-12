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
    summary: "Implementation complete.",
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
    summary: "Looks good",
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
      protectedPaths: ["protected/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 2,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
    ...overrides,
  };
}

describe("PolicyEngine", () => {
  const policy = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning when run is in Todo state", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning when run is already in Planning state (re-plan)", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws PolicyViolationError with the correct rule when run is in an unrelated state", () => {
      const run = makeRun({ state: RunState.Implementing });
      try {
        policy.assertCanPlan(run);
        throw new Error("expected assertCanPlan to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toContain("Implementing");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("passes when state is Implementing, plan is approved, and versions match", () => {
      const plan = makePlan({ planVersion: 2 });
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      expect(() => policy.assertCanExecute(run, plan)).not.toThrow();
    });

    it("throws execute_requires_implementing_state when run is not Implementing", () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
      try {
        policy.assertCanExecute(run, makePlan());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("throws execute_requires_explicit_approval when approvedPlanVersion is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      try {
        policy.assertCanExecute(run, makePlan());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("throws execute_requires_plan_artifact when plan is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        policy.assertCanExecute(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("throws execute_plan_version_mismatch when plan.planVersion !== approvedPlanVersion", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 3 });
      try {
        policy.assertCanExecute(run, plan);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v3");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });
  });

  describe("assertCanReview", () => {
    it("passes when state is AIReview, PR exists, and execution report exists", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("throws review_requires_ai_review_state when run is not AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
      try {
        policy.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("throws review_requires_pr when run has no prNumber", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        policy.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("throws review_requires_execution_report when executionReport is null", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      try {
        policy.assertCanReview(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });
  });

  describe("assertCanRemediate", () => {
    it("passes when state is AddressingReview, review exists with changes_requested verdict and findings", () => {
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
            details: "details",
          },
        ],
      });
      expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
    });

    it("throws remediate_requires_addressing_review_state when run is not AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      try {
        policy.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("throws remediate_requires_review when review is null", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        policy.assertCanRemediate(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("throws remediate_requires_changes_requested_verdict when verdict is approved", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      try {
        policy.assertCanRemediate(run, review);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
        expect((err as PolicyViolationError).message).toContain("approved");
      }
    });

    it("throws remediate_requires_findings when findings array is empty", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        policy.assertCanRemediate(run, review);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });
  });

  describe("assertCanMarkReady", () => {
    function approvedReview(overrides: Partial<Review> = {}): Review {
      return makeReview({ overallVerdict: "approved", findings: [], ...overrides });
    }

    it("passes when PR exists, checks are green, and review is approved with no blockers", () => {
      const run = makeRun({ prNumber: 7 });
      expect(() =>
        policy.assertCanMarkReady(run, approvedReview(), makeExecutionReport()),
      ).not.toThrow();
    });

    it("throws ready_requires_pr when run has no prNumber", () => {
      const run = makeRun({ prNumber: null });
      try {
        policy.assertCanMarkReady(run, approvedReview(), makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("throws ready_requires_execution_report when executionReport is null", () => {
      const run = makeRun({ prNumber: 7 });
      try {
        policy.assertCanMarkReady(run, approvedReview(), null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "throws ready_requires_green_checks when %s check failed",
      (checkName) => {
        const run = makeRun({ prNumber: 7 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
            [checkName]: { status: "fail", details: "broken" },
          } as ExecutionReport["checks"],
        });
        try {
          policy.assertCanMarkReady(run, approvedReview(), report);
          throw new Error("expected throw");
        } catch (err) {
          expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
        }
      },
    );

    it("throws before checking review when checks fail AND review is also missing (ordering)", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "broken" },
        },
      });
      try {
        policy.assertCanMarkReady(run, null, report);
        throw new Error("expected throw");
      } catch (err) {
        // Checks are asserted before the review-existence check, so the failing
        // checks are reported first, not "ready_requires_review".
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("throws ready_requires_review when review is null but checks are green", () => {
      const run = makeRun({ prNumber: 7 });
      try {
        policy.assertCanMarkReady(run, null, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("throws ready_requires_approved_verdict when review verdict is changes_requested", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "src/foo.ts",
            title: "Bug",
            details: "details",
          },
        ],
      });
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("throws ready_requires_blockers_resolved when an approved review still has unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 7 });
      const review = approvedReview({
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/foo.ts",
            title: "Blocker bug",
            details: "details",
          },
          {
            id: "f2",
            severity: "nit",
            type: "style",
            file: "src/foo.ts",
            title: "Nit",
            details: "details",
          },
        ],
      });
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1 unresolved blocker");
      }
    });

    it("passes when an approved review has only non-blocker findings", () => {
      const run = makeRun({ prNumber: 7 });
      const review = approvedReview({
        findings: [
          {
            id: "f1",
            severity: "suggestion",
            type: "style",
            file: "src/foo.ts",
            title: "Suggestion",
            details: "details",
          },
        ],
      });
      expect(() =>
        policy.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("passes when no files touch protected paths and file count is within the limit", () => {
      const bundle = makeTaskBundle();
      expect(() =>
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("throws executor_touched_protected_path when a changed file starts with a protected path", () => {
      const bundle = makeTaskBundle({
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "ai/lin-1",
          repoPath: "/tmp",
          allowedPaths: ["src/"],
          protectedPaths: ["src/secrets/"],
        },
      });
      try {
        policy.assertExecutorPaths(["src/secrets/keys.ts"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("src/secrets/keys.ts");
      }
    });

    it("throws executor_exceeded_max_files when filesChanged exceeds maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("2 files");
      }
    });

    it("checks protected paths before the max-files limit (ordering: protected-path violation wins)", () => {
      const bundle = makeTaskBundle({
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "ai/lin-1",
          repoPath: "/tmp",
          allowedPaths: ["src/"],
          protectedPaths: ["src/secrets/"],
        },
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        // Two files: exceeds maxFilesChanged AND one touches a protected path.
        policy.assertExecutorPaths(["src/secrets/keys.ts", "src/a.ts"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });

    it("passes with an empty filesChanged list", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
