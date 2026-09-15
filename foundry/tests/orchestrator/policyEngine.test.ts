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
    latestArtifactVersion: 0,
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
    steps: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    ...overrides,
  } as unknown as Plan;
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
    reviewId: "rev-1",
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
      title: "title",
      description: "desc",
      labels: [],
      priority: 1,
    },
    repo: {
      name: "repo",
      defaultBranch: "main",
      workingBranch: "feature",
      repoPath: "/repo",
      allowedPaths: [],
      protectedPaths: ["protected/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 2,
      maxDiffLines: 100,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
    ...overrides,
  };
}

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("does not throw when run is in Todo state", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("does not throw when run is in Planning state", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws PolicyViolationError with rule 'plan_requires_todo_or_planning_state' otherwise", () => {
      const run = makeRun({ state: RunState.Implementing });
      expect(() => engine.assertCanPlan(run)).toThrow(PolicyViolationError);
      try {
        engine.assertCanPlan(run);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("throws 'execute_requires_implementing_state' when run is not Implementing", () => {
      const run = makeRun({ state: RunState.Todo });
      expect(() => engine.assertCanExecute(run, null)).toThrow(PolicyViolationError);
      try {
        engine.assertCanExecute(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("throws 'execute_requires_explicit_approval' when approvedPlanVersion is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      expect(() => engine.assertCanExecute(run, makePlan())).toThrow(PolicyViolationError);
      try {
        engine.assertCanExecute(run, makePlan());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("throws 'execute_requires_plan_artifact' when plan is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, null)).toThrow(PolicyViolationError);
      try {
        engine.assertCanExecute(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("throws 'execute_plan_version_mismatch' when plan version differs from approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      expect(() => engine.assertCanExecute(run, plan)).toThrow(PolicyViolationError);
      try {
        engine.assertCanExecute(run, plan);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
      }
    });

    it("does not throw when state matches, approval is set, plan exists and versions match", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      const plan = makePlan({ planVersion: 3 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("throws 'review_requires_ai_review_state' when run is not in AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("throws 'review_requires_pr' when run has no prNumber", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("throws 'review_requires_execution_report' when executionReport is null", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => engine.assertCanReview(run, null)).toThrow(PolicyViolationError);
      try {
        engine.assertCanReview(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("does not throw when state is AIReview, prNumber set, and execution report present", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("throws 'remediate_requires_addressing_review_state' when run is not in AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect(() => engine.assertCanRemediate(run, review)).toThrow(PolicyViolationError);
      try {
        engine.assertCanRemediate(run, review);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("throws 'remediate_requires_review' when review is null", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => engine.assertCanRemediate(run, null)).toThrow(PolicyViolationError);
      try {
        engine.assertCanRemediate(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("throws 'remediate_requires_changes_requested_verdict' when verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      expect(() => engine.assertCanRemediate(run, review)).toThrow(PolicyViolationError);
      try {
        engine.assertCanRemediate(run, review);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("throws 'remediate_requires_findings' when findings are empty", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect(() => engine.assertCanRemediate(run, review)).toThrow(PolicyViolationError);
      try {
        engine.assertCanRemediate(run, review);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("does not throw when state, review, verdict, and findings are all valid", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "a.ts",
            title: "t",
            details: "d",
          },
        ],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("throws 'ready_requires_pr' when run has no prNumber", () => {
      const run = makeRun({ prNumber: null });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
      ).toThrow(PolicyViolationError);
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("throws 'ready_requires_execution_report' when executionReport is null", () => {
      const run = makeRun({ prNumber: 1 });
      expect(() => engine.assertCanMarkReady(run, makeReview(), null)).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("throws 'ready_requires_green_checks' when lint fails", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("throws 'ready_requires_green_checks' when typecheck fails", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "fail", details: "" },
          tests: { status: "pass", details: "" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrow(
        PolicyViolationError,
      );
    });

    it("throws 'ready_requires_green_checks' when tests fail", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "fail", details: "" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrow(
        PolicyViolationError,
      );
    });

    it("throws 'ready_requires_review' when review is null", () => {
      const run = makeRun({ prNumber: 1 });
      expect(() => engine.assertCanMarkReady(run, null, makeExecutionReport())).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("throws 'ready_requires_approved_verdict' when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).toThrow(PolicyViolationError);
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("throws 'ready_requires_blockers_resolved' when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "a.ts",
            title: "t",
            details: "d",
          },
        ],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).toThrow(PolicyViolationError);
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      }
    });

    it("does not throw when all conditions are satisfied", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            file: "a.ts",
            title: "t",
            details: "d",
          },
        ],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("throws 'executor_touched_protected_path' when a changed file starts with a protected path", () => {
      const bundle = makeTaskBundle();
      expect(() =>
        engine.assertExecutorPaths(["protected/file.ts"], bundle),
      ).toThrow(PolicyViolationError);
      try {
        engine.assertExecutorPaths(["protected/file.ts"], bundle);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });

    it("throws 'executor_exceeded_max_files' when changed file count exceeds max", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 100,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["a.ts", "b.ts"], bundle),
      ).toThrow(PolicyViolationError);
      try {
        engine.assertExecutorPaths(["a.ts", "b.ts"], bundle);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
      }
    });

    it("does not throw when no protected paths touched and file count within limit", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths(["src/a.ts"], bundle)).not.toThrow();
    });

    it("does not throw for an empty filesChanged list", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
