import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review, Finding } from "../../src/schemas/review.js";
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
    steps: [{ id: "s1", title: "Step 1", description: "do the thing" }],
    testPlan: "run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "executed",
    filesChanged: ["src/foo.ts"],
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

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "important",
    type: "bug",
    file: "src/foo.ts",
    title: "Some finding",
    details: "details",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "r1",
    summary: "review summary",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "Fix things",
      description: "desc",
      labels: [],
      priority: 2,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "run-1",
      repoPath: "/tmp/repo",
      allowedPaths: [],
      protectedPaths: ["infra/"],
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
    it("allows planning from Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning (re-plan)", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state, with rule code", () => {
      expect.assertions(3);
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toContain("Implementing");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("allows execution when Implementing, approved version set, and plan matches", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });

    it("rejects when run is not in Implementing state", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      const plan = makePlan({ planVersion: 1 });
      expect.assertions(2);
      try {
        engine.assertCanExecute(run, plan);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      const plan = makePlan({ planVersion: 1 });
      expect.assertions(2);
      try {
        engine.assertCanExecute(run, plan);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("rejects when plan artifact is missing", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect.assertions(2);
      try {
        engine.assertCanExecute(run, null);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("rejects when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      expect.assertions(3);
      try {
        engine.assertCanExecute(run, plan);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v1");
      }
    });
  });

  describe("assertCanReview", () => {
    it("allows review when in AIReview with PR and execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
      expect.assertions(2);
      try {
        engine.assertCanReview(run, makeExecutionReport());
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("rejects when there is no PR number", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expect.assertions(2);
      try {
        engine.assertCanReview(run, makeExecutionReport());
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("rejects when execution report is missing", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      expect.assertions(2);
      try {
        engine.assertCanReview(run, null);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });
  });

  describe("assertCanRemediate", () => {
    it("allows remediation when in AddressingReview with changes_requested review and findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [makeFinding()],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });

    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      expect.assertions(2);
      try {
        engine.assertCanRemediate(run, review);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_addressing_review_state");
      }
    });

    it("rejects when review is missing", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect.assertions(2);
      try {
        engine.assertCanRemediate(run, null);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("rejects when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved", findings: [makeFinding()] });
      expect.assertions(3);
      try {
        engine.assertCanRemediate(run, review);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
        expect((err as PolicyViolationError).message).toContain("approved");
      }
    });

    it("rejects when there are no review findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect.assertions(2);
      try {
        engine.assertCanRemediate(run, review);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });
  });

  describe("assertCanMarkReady", () => {
    it("allows marking ready when PR exists, checks are green, and review is approved with no blockers", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      const report = makeExecutionReport();
      const review = makeReview({ overallVerdict: "approved", findings: [] });
      expect(() => engine.assertCanMarkReady(run, review, report)).not.toThrow();
    });

    it("rejects when there is no PR number", () => {
      const run = makeRun({ prNumber: null });
      expect.assertions(2);
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("rejects when execution report is missing", () => {
      const run = makeRun({ prNumber: 7 });
      expect.assertions(2);
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("rejects when lint check failed", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "broken" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect.assertions(2);
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when typecheck failed", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "broken" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect.assertions(2);
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when tests failed", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "broken" },
        },
      });
      expect.assertions(2);
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("allows a skipped check (skip is not a failure)", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "n/a" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      const review = makeReview({ overallVerdict: "approved", findings: [] });
      expect(() => engine.assertCanMarkReady(run, review, report)).not.toThrow();
    });

    it("rejects when review is missing", () => {
      const run = makeRun({ prNumber: 7 });
      expect.assertions(2);
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("rejects when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect.assertions(3);
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
        expect((err as PolicyViolationError).message).toContain("changes_requested");
      }
    });

    it("rejects when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          makeFinding({ id: "b1", severity: "blocker" }),
          makeFinding({ id: "b2", severity: "blocker" }),
          makeFinding({ id: "n1", severity: "nit" }),
        ],
      });
      expect.assertions(3);
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("2");
      }
    });

    it("allows non-blocker findings (e.g. suggestion/nit) to pass through", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "suggestion" }), makeFinding({ severity: "nit" })],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows changes within limits and outside protected paths", () => {
      const bundle = makeTaskBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/foo.ts", "src/bar.ts"], bundle),
      ).not.toThrow();
    });

    it("rejects when a changed file starts with a protected path", () => {
      const bundle = makeTaskBundle({
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "run-1",
          repoPath: "/tmp/repo",
          allowedPaths: [],
          protectedPaths: ["infra/"],
        },
      });
      expect.assertions(3);
      try {
        engine.assertExecutorPaths(["infra/deploy.ts"], bundle);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("infra/deploy.ts");
      }
    });

    it("rejects when the number of changed files exceeds the max", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect.assertions(3);
      try {
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle);
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("2");
      }
    });

    it("allows an empty file list", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });

    it("checks protected paths before the max-files limit (protected path wins first)", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "run-1",
          repoPath: "/tmp/repo",
          allowedPaths: [],
          protectedPaths: ["infra/"],
        },
      });
      expect.assertions(1);
      try {
        engine.assertExecutorPaths(["infra/deploy.ts", "src/a.ts"], bundle);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });
  });
});
