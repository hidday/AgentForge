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
    summary: "Implemented.",
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

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "T", description: "D", labels: [], priority: 0 },
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
    it("allows Todo state", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows Planning state", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects any other state with PolicyViolationError and rule code", () => {
      try {
        policy.assertCanPlan(makeRun({ state: RunState.Done }));
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("rejects when not Implementing", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      expect(() => policy.assertCanExecute(run, makePlan({ planVersion: 1 }))).toThrowError(
        expect.objectContaining({ rule: "execute_requires_implementing_state" }),
      );
    });

    it("rejects when approvedPlanVersion is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      expect(() => policy.assertCanExecute(run, makePlan())).toThrowError(
        expect.objectContaining({ rule: "execute_requires_explicit_approval" }),
      );
    });

    it("rejects when plan artifact is missing", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect(() => policy.assertCanExecute(run, null)).toThrowError(
        expect.objectContaining({ rule: "execute_requires_plan_artifact" }),
      );
    });

    it("rejects when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      expect(() => policy.assertCanExecute(run, makePlan({ planVersion: 1 }))).toThrowError(
        expect.objectContaining({ rule: "execute_plan_version_mismatch" }),
      );
    });

    it("allows when Implementing, approved, and plan version matches", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      expect(() =>
        policy.assertCanExecute(run, makePlan({ planVersion: 3 })),
      ).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "review_requires_ai_review_state" }),
      );
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "review_requires_pr" }),
      );
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => policy.assertCanReview(run, null)).toThrowError(
        expect.objectContaining({ rule: "review_requires_execution_report" }),
      );
    });

    it("allows when AIReview, has PR, and has execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      expect(() => policy.assertCanRemediate(run, makeReview())).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_addressing_review_state" }),
      );
    });

    it("rejects when review artifact is missing", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => policy.assertCanRemediate(run, null)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_review" }),
      );
    });

    it("rejects when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() =>
        policy.assertCanRemediate(run, makeReview({ overallVerdict: "approved" })),
      ).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_changes_requested_verdict" }),
      );
    });

    it("rejects when there are no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() =>
        policy.assertCanRemediate(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
        ),
      ).toThrowError(expect.objectContaining({ rule: "remediate_requires_findings" }));
    });

    it("allows when AddressingReview, changes_requested, and findings exist", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      expect(() => policy.assertCanMarkReady(run, makeReview(), makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_pr" }),
      );
    });

    it("rejects when execution report is missing", () => {
      const run = makeRun({ prNumber: 1 });
      expect(() => policy.assertCanMarkReady(run, makeReview(), null)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_execution_report" }),
      );
    });

    it("rejects when lint failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "bad" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => policy.assertCanMarkReady(run, makeReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when typecheck failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "bad" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => policy.assertCanMarkReady(run, makeReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when tests failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "bad" },
        },
      });
      expect(() => policy.assertCanMarkReady(run, makeReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when review is missing", () => {
      const run = makeRun({ prNumber: 1 });
      expect(() => policy.assertCanMarkReady(run, null, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_review" }),
      );
    });

    it("rejects when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 1 });
      expect(() =>
        policy.assertCanMarkReady(
          run,
          makeReview({ overallVerdict: "changes_requested" }),
          makeExecutionReport(),
        ),
      ).toThrowError(expect.objectContaining({ rule: "ready_requires_approved_verdict" }));
    });

    it("rejects when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_blockers_resolved" }),
      );
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("expected throw");
      } catch (err) {
        expect((err as Error).message).toContain("1 unresolved blocker");
      }
    });

    it("allows when PR exists, checks pass, review approved, and no blocker findings", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("rejects when a changed file is under a protected path", () => {
      const bundle = makeBundle();
      expect(() =>
        policy.assertExecutorPaths(["secrets/keys.json"], bundle),
      ).toThrowError(expect.objectContaining({ rule: "executor_touched_protected_path" }));
    });

    it("rejects when more files changed than maxFilesChanged", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).toThrowError(expect.objectContaining({ rule: "executor_exceeded_max_files" }));
    });

    it("allows when no protected paths touched and within max files", () => {
      const bundle = makeBundle();
      expect(() => policy.assertExecutorPaths(["src/a.ts"], bundle)).not.toThrow();
    });

    it("allows an empty file list", () => {
      const bundle = makeBundle();
      expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
