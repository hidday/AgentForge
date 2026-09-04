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
    linearIssueIdentifier: "LIN-1",
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
    summary: "Do the thing",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
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
    scoreRationale: "Looks good",
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

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "Fix bug",
      description: "desc",
      labels: [],
      priority: 2,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "run/1",
      repoPath: "/repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secrets/", ".env"],
    },
    constraints: {
      requiredChecks: ["lint", "typecheck", "tests"],
      maxFilesChanged: 3,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["Tests pass"],
    ...overrides,
  };
}

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning from Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning (replanning)", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state", () => {
      const run = makeRun({ state: RunState.Implementing });
      expect(() => engine.assertCanPlan(run)).toThrow(PolicyViolationError);
      try {
        engine.assertCanPlan(run);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toContain("Implementing");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("rejects when run is not Implementing", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("rejects when approvedPlanVersion is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("rejects when plan artifact is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("rejects when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v1");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });

    it("allows execution when state, approval, plan, and versions all line up", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      const plan = makePlan({ planVersion: 3 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("rejects when run is not in AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 5 });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("rejects when run has no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("rejects when execution report is missing", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      try {
        engine.assertCanReview(run, null);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("allows review when state, PR and execution report are all present", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("rejects when run is not in AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "x", details: "y" },
      ] });
      try {
        engine.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_addressing_review_state");
      }
    });

    it("rejects when review is missing", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("rejects when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      try {
        engine.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
        expect((err as PolicyViolationError).message).toContain("approved");
      }
    });

    it("rejects when review has no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        engine.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("allows remediation when state, review, verdict, and findings all satisfy policy", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "x", details: "y" },
        ],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("rejects when run has no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("rejects when execution report is missing", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("rejects when lint check failed", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "lint errors" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when typecheck failed", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "type errors" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when tests failed", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "test failures" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("allows checks with skip status (does not treat skip as failure)", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "no linter configured" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
    });

    it("rejects when review is missing", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("rejects when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("rejects when there are unresolved blocker findings even if verdict is approved", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "x", details: "y" },
          { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "z", details: "w" },
        ],
      });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1");
      }
    });

    it("allows marking ready when PR, checks, review and findings all satisfy policy", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "x", details: "y" },
        ],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows an empty file list", () => {
      const bundle = makeBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });

    it("rejects when a changed file starts with a protected path", () => {
      const bundle = makeBundle({
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "run/1",
          repoPath: "/repo",
          allowedPaths: ["src/"],
          protectedPaths: ["src/secrets/"],
        },
      });
      try {
        engine.assertExecutorPaths(["src/secrets/keys.ts"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("src/secrets/keys.ts");
      }
    });

    it("allows files that do not match any protected path prefix", () => {
      const bundle = makeBundle({
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "run/1",
          repoPath: "/repo",
          allowedPaths: ["src/"],
          protectedPaths: ["src/secrets/"],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["src/index.ts", "src/utils/helpers.ts"], bundle),
      ).not.toThrow();
    });

    it("rejects when the number of changed files exceeds maxFilesChanged", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        engine.assertExecutorPaths(["a.ts", "b.ts", "c.ts"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("3");
        expect((err as PolicyViolationError).message).toContain("2");
      }
    });

    it("allows exactly maxFilesChanged files (boundary — not an overage)", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() => engine.assertExecutorPaths(["a.ts", "b.ts"], bundle)).not.toThrow();
    });

    it("checks protected paths before the file-count limit (protected-path violation reported first)", () => {
      const bundle = makeBundle({
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "run/1",
          repoPath: "/repo",
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
      // Two files exceed maxFilesChanged AND one is protected — protected-path
      // check runs first in the implementation, so that rule should win.
      try {
        engine.assertExecutorPaths(["src/secrets/keys.ts", "src/index.ts"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });
  });
});
