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
    summary: "Do the thing",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "desc" }],
    testPlan: "run tests",
    confidence: 0.8,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Done",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
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
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
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
      workingBranch: "feature",
      repoPath: "/repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secrets/", ".github/"],
    },
    constraints: {
      requiredChecks: ["lint", "test"],
      maxFilesChanged: 3,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["All tests pass"],
    ...overrides,
  };
}

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning from Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning (re-plan)", () => {
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
    it("allows execution when state is Implementing, approval set, and plan version matches", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      const plan = makePlan({ planVersion: 1 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });

    it("rejects when state is not Implementing", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("rejects when there is no plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
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
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v1");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });
  });

  describe("assertCanReview", () => {
    it("allows review when state is AIReview, PR exists, and execution report exists", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("rejects when state is not AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("rejects when there is no PR number", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      try {
        engine.assertCanReview(run, null);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });
  });

  describe("assertCanRemediate", () => {
    it("allows remediation when state is AddressingReview, review exists with changes_requested and findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "src/a.ts",
            title: "issue",
            details: "details",
          },
        ],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });

    it("rejects when state is not AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      try {
        engine.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("rejects when there is no review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("rejects when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved", findings: [] });
      try {
        engine.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("rejects when review has no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        engine.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });
  });

  describe("assertCanMarkReady", () => {
    it("allows mark-ready when PR exists, checks green, review approved with no blockers", () => {
      const run = makeRun({ prNumber: 42 });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
      ).not.toThrow();
    });

    it("rejects when there is no PR number", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 42 });
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("rejects when lint check failed", () => {
      const run = makeRun({ prNumber: 42 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when typecheck check failed", () => {
      const run = makeRun({ prNumber: 42 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "fail", details: "" },
          tests: { status: "pass", details: "" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when tests check failed", () => {
      const run = makeRun({ prNumber: 42 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "fail", details: "" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("allows mark-ready when a check is skipped (not fail)", () => {
      const run = makeRun({ prNumber: 42 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
      });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), report),
      ).not.toThrow();
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ prNumber: 42 });
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("rejects when latest review verdict is not approved", () => {
      const run = makeRun({ prNumber: 42 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("rejects when there are unresolved blocker findings even if verdict is approved", () => {
      const run = makeRun({ prNumber: 42 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/a.ts",
            title: "issue",
            details: "details",
          },
          {
            id: "f2",
            severity: "nit",
            type: "style",
            file: "src/b.ts",
            title: "nit",
            details: "details",
          },
        ],
      });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1");
      }
    });

    it("allows mark-ready when findings exist but none are blockers", () => {
      const run = makeRun({ prNumber: 42 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            file: "src/b.ts",
            title: "nit",
            details: "details",
          },
        ],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows changes within file limit that do not touch protected paths", () => {
      const bundle = makeTaskBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      ).not.toThrow();
    });

    it("rejects when a changed file is under a protected path", () => {
      const bundle = makeTaskBundle();
      try {
        engine.assertExecutorPaths(["src/secrets/key.ts"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("src/secrets/key.ts");
      }
    });

    it("checks protected paths by prefix match (startsWith), not exact equality", () => {
      const bundle = makeTaskBundle({
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "feature",
          repoPath: "/repo",
          allowedPaths: ["src/"],
          protectedPaths: [".github/"],
        },
      });
      // Should not throw: this file is not prefixed by ".github/"
      expect(() => engine.assertExecutorPaths(["src/workflow.ts"], bundle)).not.toThrow();
      // Should throw: this file is prefixed by ".github/"
      expect(() =>
        engine.assertExecutorPaths([".github/workflows/ci.yml"], bundle),
      ).toThrow(PolicyViolationError);
    });

    it("rejects when files changed exceeds maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 100,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("3");
        expect((err as PolicyViolationError).message).toContain("2");
      }
    });

    it("allows exactly maxFilesChanged files (boundary: equal to limit passes)", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 100,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });

    it("rejects at maxFilesChanged + 1 (boundary: one over the limit fails)", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 100,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      ).toThrow(PolicyViolationError);
    });

    it("checks protected paths before the file count limit (fails fast on first violated file)", () => {
      // Only one file, well within maxFilesChanged, but it is protected.
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 100,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        engine.assertExecutorPaths(["src/secrets/key.ts"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });

    it("allows an empty file list", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
