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
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  } as Plan;
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
    score: 1,
    scoreRationale: "all good",
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
      protectedPaths: ["src/generated/", "prisma/schema.prisma"],
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

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning when the run is Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning when the run is already Planning", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state", () => {
      const run = makeRun({ state: RunState.Implementing });
      expect(() => engine.assertCanPlan(run)).toThrow(PolicyViolationError);
      try {
        engine.assertCanPlan(run);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("rejects when the run is not Implementing", () => {
      const run = makeRun({ state: RunState.Planning });
      expect(() => engine.assertCanExecute(run, makePlan())).toThrow(PolicyViolationError);
      try {
        engine.assertCanExecute(run, makePlan());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      try {
        engine.assertCanExecute(run, makePlan());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("rejects when there is no plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("rejects when the plan version does not match the approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v1");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });

    it("allows execution when Implementing, approved, and plan version matches", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("rejects when the run is not AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      try {
        engine.assertCanReview(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("allows review when AIReview, PR exists, and execution report exists", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("rejects when the run is not AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        engine.assertCanRemediate(run, review);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("rejects when the review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      try {
        engine.assertCanRemediate(run, review);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("rejects when there are no findings to remediate", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        engine.assertCanRemediate(run, review);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("allows remediation when AddressingReview, changes_requested, and findings exist", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "src/a.ts",
            title: "Issue",
            details: "details",
          },
        ],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("rejects when lint check failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "lint errors" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when typecheck failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "type errors" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when tests failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "test failures" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("allows a skipped check (not a failure) through the green-checks gate", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "not configured" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("rejects when the review verdict is not approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("rejects when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/a.ts",
            title: "Blocker",
            details: "details",
          },
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

    it("allows marking ready when approved, green checks, and no blockers", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            file: "src/a.ts",
            title: "Nit",
            details: "details",
          },
        ],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("rejects when a changed file starts with a protected path prefix", () => {
      const bundle = makeTaskBundle();
      try {
        engine.assertExecutorPaths(["src/generated/client.ts"], bundle);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("src/generated/client.ts");
      }
    });

    it("does not flag a file that merely shares a prefix word but not the protected path", () => {
      const bundle = makeTaskBundle({
        repo: {
          ...makeTaskBundle().repo,
          protectedPaths: ["src/generated/"],
        },
      });
      // "src/generatedFoo.ts" does not start with "src/generated/"
      expect(() =>
        engine.assertExecutorPaths(["src/generatedFoo.ts"], bundle),
      ).not.toThrow();
    });

    it("rejects when more files changed than maxFilesChanged allows", () => {
      const bundle = makeTaskBundle({
        constraints: { ...makeTaskBundle().constraints, maxFilesChanged: 2 },
      });
      try {
        engine.assertExecutorPaths(["a.ts", "b.ts", "c.ts"], bundle);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("3 files");
      }
    });

    it("allows exactly maxFilesChanged files with no protected paths touched", () => {
      const bundle = makeTaskBundle({
        constraints: { ...makeTaskBundle().constraints, maxFilesChanged: 2 },
      });
      expect(() => engine.assertExecutorPaths(["a.ts", "b.ts"], bundle)).not.toThrow();
    });

    it("checks protected-path violations before the file-count limit", () => {
      const bundle = makeTaskBundle({
        constraints: { ...makeTaskBundle().constraints, maxFilesChanged: 100 },
      });
      try {
        engine.assertExecutorPaths(["src/generated/x.ts"], bundle);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });
  });
});
