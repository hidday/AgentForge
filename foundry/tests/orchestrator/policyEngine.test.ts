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
    summary: "summary",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [],
    testPlan: "test plan",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "did the thing",
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
    reviewId: "review-1",
    summary: "looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "Title",
      description: "Description",
      labels: [],
      priority: 2,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/repo",
      allowedPaths: [],
      protectedPaths: ["infra/", ".github/"],
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
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toContain("Implementing");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("rejects when not in Implementing state", () => {
      const run = makeRun({ state: RunState.Todo, approvedPlanVersion: 1 });
      const plan = makePlan({ planVersion: 1 });
      expect(() => engine.assertCanExecute(run, plan)).toThrow(PolicyViolationError);
      try {
        engine.assertCanExecute(run, plan);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      const plan = makePlan({ planVersion: 1 });
      expect(() => engine.assertCanExecute(run, plan)).toThrow(PolicyViolationError);
      try {
        engine.assertCanExecute(run, plan);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("rejects when plan is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, null)).toThrow(PolicyViolationError);
      try {
        engine.assertCanExecute(run, null);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("rejects when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      expect(() => engine.assertCanExecute(run, plan)).toThrow(PolicyViolationError);
      try {
        engine.assertCanExecute(run, plan);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v1");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });

    it("allows execution when state, approval and plan version all align", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      const plan = makePlan({ planVersion: 3 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      const report = makeExecutionReport();
      expect(() => engine.assertCanReview(run, report)).toThrow(PolicyViolationError);
      try {
        engine.assertCanReview(run, report);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      const report = makeExecutionReport();
      expect(() => engine.assertCanReview(run, report)).toThrow(PolicyViolationError);
      try {
        engine.assertCanReview(run, report);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => engine.assertCanReview(run, null)).toThrow(PolicyViolationError);
      try {
        engine.assertCanReview(run, null);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("allows review when in AIReview state with PR and execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      expect(() => engine.assertCanRemediate(run, review)).toThrow(PolicyViolationError);
      try {
        engine.assertCanRemediate(run, review);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => engine.assertCanRemediate(run, null)).toThrow(PolicyViolationError);
      try {
        engine.assertCanRemediate(run, null);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("rejects when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved", findings: [] });
      expect(() => engine.assertCanRemediate(run, review)).toThrow(PolicyViolationError);
      try {
        engine.assertCanRemediate(run, review);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("rejects when review has changes_requested verdict but no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect(() => engine.assertCanRemediate(run, review)).toThrow(PolicyViolationError);
      try {
        engine.assertCanRemediate(run, review);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("allows remediation when in AddressingReview with changes_requested review and findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
      ).toThrow(PolicyViolationError);
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 5 });
      expect(() => engine.assertCanMarkReady(run, makeReview(), null)).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("rejects when lint check failed", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "broken" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when typecheck check failed", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "broken" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrow(
        PolicyViolationError,
      );
    });

    it("rejects when tests check failed", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "broken" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrow(
        PolicyViolationError,
      );
    });

    it("allows skipped checks (skip is not fail)", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "n/a" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ prNumber: 5 });
      expect(() => engine.assertCanMarkReady(run, null, makeExecutionReport())).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("rejects when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("rejects when there are unresolved blocker findings even if verdict is approved", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "blocker" }), makeFinding({ severity: "nit" })],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1");
      }
    });

    it("allows marking ready when PR, green checks, approved review with no blockers", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "nit" })],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("throws when a changed file starts with a protected path", () => {
      const bundle = makeBundle();
      expect(() =>
        engine.assertExecutorPaths(["infra/deploy.yml"], bundle),
      ).toThrow(PolicyViolationError);
      try {
        engine.assertExecutorPaths(["infra/deploy.yml"], bundle);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("infra/deploy.yml");
      }
    });

    it("does not throw for files outside protected paths and within max files", () => {
      const bundle = makeBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      ).not.toThrow();
    });

    it("throws when file count exceeds maxFilesChanged", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      ).toThrow(PolicyViolationError);
      try {
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("3");
        expect((err as PolicyViolationError).message).toContain("max: 2");
      }
    });

    it("allows exactly maxFilesChanged files (boundary: at limit is fine)", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 3,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      ).not.toThrow();
    });

    it("throws for exactly one file over the limit (boundary: one over fails)", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 3,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"], bundle),
      ).toThrow(PolicyViolationError);
    });

    it("prioritizes protected-path violation over max-files violation when both apply", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        engine.assertExecutorPaths(["infra/deploy.yml", "src/a.ts"], bundle);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });

    it("treats an empty changed-files list as compliant", () => {
      const bundle = makeBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});

function makeFinding(overrides: Partial<Review["findings"][number]> = {}) {
  return {
    id: "finding-1",
    severity: "important" as const,
    type: "bug",
    file: "src/a.ts",
    title: "Some finding",
    details: "Details here",
    ...overrides,
  };
}
