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
    summary: "Executed",
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

function makeFinding(overrides: Partial<Review["findings"][number]> = {}): Review["findings"][number] {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/a.ts",
    title: "Issue",
    details: "Details",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Issue",
      description: "Desc",
      labels: [],
      priority: 1,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/generated/"],
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
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("does not throw when run is in Todo state", () => {
      const run = makeRun({ state: RunState.Todo });
      expect(() => engine.assertCanPlan(run)).not.toThrow();
    });

    it("does not throw when run is in Planning state", () => {
      const run = makeRun({ state: RunState.Planning });
      expect(() => engine.assertCanPlan(run)).not.toThrow();
    });

    it("throws PolicyViolationError with the correct rule when run is in another state", () => {
      const run = makeRun({ state: RunState.Implementing });
      try {
        engine.assertCanPlan(run);
        throw new Error("expected assertCanPlan to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toBe(
          'Cannot plan when run is in state "Implementing"',
        );
      }
    });
  });

  describe("assertCanExecute", () => {
    it("throws when run is not in Implementing state", () => {
      const run = makeRun({ state: RunState.Planning });
      const plan = makePlan();
      try {
        engine.assertCanExecute(run, plan);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("throws when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      const plan = makePlan();
      try {
        engine.assertCanExecute(run, plan);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("throws when there is no plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("throws when the plan version does not match the approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toBe(
          "Plan version mismatch: plan is v1 but approved version is v2",
        );
      }
    });

    it("does not throw when state, approval, and plan version all line up", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("throws when run is not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("throws when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("throws when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
      try {
        engine.assertCanReview(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("does not throw when state, PR, and execution report are all present", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("throws when run is not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      try {
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("throws when there is no review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("throws when the review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved", findings: [makeFinding()] });
      try {
        engine.assertCanRemediate(run, review);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
        expect((err as PolicyViolationError).message).toBe(
          'Cannot remediate when review verdict is "approved" (must be "changes_requested")',
        );
      }
    });

    it("throws when there are no review findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        engine.assertCanRemediate(run, review);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("does not throw when state is AddressingReview, verdict is changes_requested, and findings exist", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [makeFinding()],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("throws when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("throws when there is no execution report", () => {
      const run = makeRun({ prNumber: 10 });
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("throws when lint check failed", () => {
      const run = makeRun({ prNumber: 10 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "bad" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("throws when typecheck failed", () => {
      const run = makeRun({ prNumber: 10 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "bad" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("throws when tests failed", () => {
      const run = makeRun({ prNumber: 10 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "bad" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("throws when there is no review", () => {
      const run = makeRun({ prNumber: 10 });
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("throws when the review verdict is not approved", () => {
      const run = makeRun({ prNumber: 10 });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
        expect((err as PolicyViolationError).message).toBe(
          'Cannot mark ready when latest review verdict is "changes_requested" (must be "approved")',
        );
      }
    });

    it("throws when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 10 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "blocker" }), makeFinding({ severity: "nit" })],
      });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toBe(
          "Cannot mark ready with 1 unresolved blocker findings",
        );
      }
    });

    it("does not throw when PR, report, checks, and an approved review with no blockers all line up", () => {
      const run = makeRun({ prNumber: 10 });
      const review = makeReview({ overallVerdict: "approved", findings: [makeFinding({ severity: "nit" })] });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("throws when a changed file is under a protected path", () => {
      const bundle = makeTaskBundle();
      try {
        engine.assertExecutorPaths(["src/generated/foo.ts"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toBe(
          "Executor modified protected path: src/generated/foo.ts",
        );
      }
    });

    it("throws when the number of changed files exceeds maxFilesChanged", () => {
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
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toBe(
          "Executor changed 3 files (max: 2)",
        );
      }
    });

    it("does not throw when no protected paths are touched and the file count is within the limit", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });

    it("does not throw for an empty filesChanged list", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
