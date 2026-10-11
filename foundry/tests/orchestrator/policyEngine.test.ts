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
    summary: "Did work",
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
      protectedPaths: ["infra/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
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
    it("allows Todo state", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows Planning state", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws PolicyViolationError with rule 'plan_requires_todo_or_planning_state' for any other state", () => {
      try {
        policy.assertCanPlan(makeRun({ state: RunState.Implementing }));
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toContain("Implementing");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("allows Implementing state with matching approved plan version and plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => policy.assertCanExecute(run, plan)).not.toThrow();
    });

    it("throws 'execute_requires_implementing_state' when not in Implementing", () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 2 });
      try {
        policy.assertCanExecute(run, makePlan({ planVersion: 2 }));
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("throws 'execute_requires_explicit_approval' when approvedPlanVersion is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      try {
        policy.assertCanExecute(run, makePlan());
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("throws 'execute_requires_plan_artifact' when plan is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        policy.assertCanExecute(run, null);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("throws 'execute_plan_version_mismatch' with both versions in the message when plan version != approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      const plan = makePlan({ planVersion: 2 });
      try {
        policy.assertCanExecute(run, plan);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v2");
        expect((err as PolicyViolationError).message).toContain("v3");
      }
    });
  });

  describe("assertCanReview", () => {
    it("allows AIReview state with a PR and an execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("throws 'review_requires_ai_review_state' when not in AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 5 });
      try {
        policy.assertCanReview(run, makeExecutionReport());
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("throws 'review_requires_pr' when prNumber is null", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        policy.assertCanReview(run, makeExecutionReport());
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("throws 'review_requires_execution_report' when executionReport is null", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      try {
        policy.assertCanReview(run, null);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });
  });

  describe("assertCanRemediate", () => {
    it("allows AddressingReview state with a changes_requested review containing findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "a.ts",
            title: "Bug",
            details: "details",
          },
        ],
      });
      expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
    });

    it("throws 'remediate_requires_addressing_review_state' when not in AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      try {
        policy.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("throws 'remediate_requires_review' when review is null", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        policy.assertCanRemediate(run, null);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("throws 'remediate_requires_changes_requested_verdict' when verdict is approved", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      try {
        policy.assertCanRemediate(run, review);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
        expect((err as PolicyViolationError).message).toContain("approved");
      }
    });

    it("throws 'remediate_requires_findings' when findings array is empty", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        policy.assertCanRemediate(run, review);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });
  });

  describe("assertCanMarkReady", () => {
    it("allows when PR exists, checks pass, and review is approved with no blockers", () => {
      const run = makeRun({ prNumber: 5 });
      expect(() =>
        policy.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
      ).not.toThrow();
    });

    it("throws 'ready_requires_pr' when prNumber is null", () => {
      const run = makeRun({ prNumber: null });
      try {
        policy.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("throws 'ready_requires_execution_report' when executionReport is null", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        policy.assertCanMarkReady(run, makeReview(), null);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("throws 'ready_requires_green_checks' when lint fails", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "lint failed" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        policy.assertCanMarkReady(run, makeReview(), report);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("throws 'ready_requires_green_checks' when typecheck fails", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "typecheck failed" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        policy.assertCanMarkReady(run, makeReview(), report);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("throws 'ready_requires_green_checks' when tests fail", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "tests failed" },
        },
      });
      try {
        policy.assertCanMarkReady(run, makeReview(), report);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("does not throw on green checks when a check status is 'skip'", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "skipped" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() =>
        policy.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), report),
      ).not.toThrow();
    });

    it("throws 'ready_requires_review' when review is null", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        policy.assertCanMarkReady(run, null, makeExecutionReport());
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("throws 'ready_requires_approved_verdict' when review verdict is changes_requested", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "a.ts",
            title: "Bug",
            details: "details",
          },
        ],
      });
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
        expect((err as PolicyViolationError).message).toContain("changes_requested");
      }
    });

    it("throws 'ready_requires_blockers_resolved' with the count of blocker findings when review is approved but has unresolved blockers", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "a.ts",
            title: "Bug 1",
            details: "details",
          },
          {
            id: "f2",
            severity: "blocker",
            type: "bug",
            file: "b.ts",
            title: "Bug 2",
            details: "details",
          },
          {
            id: "f3",
            severity: "nit",
            type: "style",
            file: "c.ts",
            title: "Nit",
            details: "details",
          },
        ],
      });
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("2 unresolved blocker findings");
      }
    });

    it("does not throw when review is approved and findings are all non-blocker severities", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            file: "a.ts",
            title: "Nit",
            details: "details",
          },
        ],
      });
      expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("does not throw when no files are protected and the count is within the max", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });

    it("throws 'executor_touched_protected_path' naming the offending file when a protected path prefix is touched", () => {
      const bundle = makeTaskBundle({
        repo: { ...makeTaskBundle().repo, protectedPaths: ["infra/"] },
      });
      try {
        policy.assertExecutorPaths(["src/a.ts", "infra/secrets.yaml"], bundle);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("infra/secrets.yaml");
      }
    });

    it("throws 'executor_exceeded_max_files' with actual and max counts when filesChanged.length exceeds maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: { ...makeTaskBundle().constraints, maxFilesChanged: 2 },
      });
      try {
        policy.assertExecutorPaths(["a.ts", "b.ts", "c.ts"], bundle);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("3 files");
        expect((err as PolicyViolationError).message).toContain("max: 2");
      }
    });

    it("does not throw when filesChanged.length is exactly equal to maxFilesChanged (boundary)", () => {
      const bundle = makeTaskBundle({
        constraints: { ...makeTaskBundle().constraints, maxFilesChanged: 2 },
      });
      expect(() => policy.assertExecutorPaths(["a.ts", "b.ts"], bundle)).not.toThrow();
    });

    it("does not throw for an empty filesChanged array", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
    });

    it("checks protected paths before the file-count limit (protected-path violation reported even when under the max)", () => {
      const bundle = makeTaskBundle({
        repo: { ...makeTaskBundle().repo, protectedPaths: ["infra/"] },
        constraints: { ...makeTaskBundle().constraints, maxFilesChanged: 10 },
      });
      try {
        policy.assertExecutorPaths(["infra/a.ts"], bundle);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });
  });
});
