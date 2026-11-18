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
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "A plan",
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
    summary: "Done",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "all good",
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
      title: "Issue",
      description: "desc",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: ["secrets/"],
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
  const policy = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning from Todo", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning (re-planning)", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state", () => {
      const run = makeRun({ state: RunState.Implementing });
      expect(() => policy.assertCanPlan(run)).toThrow(PolicyViolationError);
      try {
        policy.assertCanPlan(run);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("allows execution when state is Implementing, plan approved and versions match", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => policy.assertCanExecute(run, plan)).not.toThrow();
    });

    it("rejects when run is not in Implementing state", () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
      const plan = makePlan({ planVersion: 1 });
      expect(() => policy.assertCanExecute(run, plan)).toThrow(
        expect.objectContaining({ rule: "execute_requires_implementing_state" }),
      );
    });

    it("rejects when approvedPlanVersion is null (no explicit approval)", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      const plan = makePlan({ planVersion: 1 });
      expect(() => policy.assertCanExecute(run, plan)).toThrow(
        expect.objectContaining({ rule: "execute_requires_explicit_approval" }),
      );
    });

    it("rejects when there is no plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect(() => policy.assertCanExecute(run, null)).toThrow(
        expect.objectContaining({ rule: "execute_requires_plan_artifact" }),
      );
    });

    it("rejects when the plan version does not match the approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      expect(() => policy.assertCanExecute(run, plan)).toThrow(
        expect.objectContaining({ rule: "execute_plan_version_mismatch" }),
      );
    });
  });

  describe("assertCanReview", () => {
    it("allows review when in AIReview with a PR and an execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).toThrow(
        expect.objectContaining({ rule: "review_requires_ai_review_state" }),
      );
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).toThrow(
        expect.objectContaining({ rule: "review_requires_pr" }),
      );
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => policy.assertCanReview(run, null)).toThrow(
        expect.objectContaining({ rule: "review_requires_execution_report" }),
      );
    });
  });

  describe("assertCanRemediate", () => {
    it("allows remediation when AddressingReview with a changes_requested review with findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
    });

    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      expect(() => policy.assertCanRemediate(run, makeReview())).toThrow(
        expect.objectContaining({ rule: "remediate_requires_addressing_review_state" }),
      );
    });

    it("rejects when there is no review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => policy.assertCanRemediate(run, null)).toThrow(
        expect.objectContaining({ rule: "remediate_requires_review" }),
      );
    });

    it("rejects when the review verdict is approved (not changes_requested)", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      expect(() => policy.assertCanRemediate(run, review)).toThrow(
        expect.objectContaining({ rule: "remediate_requires_changes_requested_verdict" }),
      );
    });

    it("rejects when there are no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect(() => policy.assertCanRemediate(run, review)).toThrow(
        expect.objectContaining({ rule: "remediate_requires_findings" }),
      );
    });
  });

  describe("assertCanMarkReady", () => {
    it("allows marking ready when PR exists, checks are green, review is approved with no blockers", () => {
      const run = makeRun({ prNumber: 7 });
      expect(() =>
        policy.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
      ).not.toThrow();
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      expect(() => policy.assertCanMarkReady(run, makeReview(), makeExecutionReport())).toThrow(
        expect.objectContaining({ rule: "ready_requires_pr" }),
      );
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 7 });
      expect(() => policy.assertCanMarkReady(run, makeReview(), null)).toThrow(
        expect.objectContaining({ rule: "ready_requires_execution_report" }),
      );
    });

    it("rejects when lint check failed", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "lint errors" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => policy.assertCanMarkReady(run, makeReview(), report)).toThrow(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when typecheck failed", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "type errors" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => policy.assertCanMarkReady(run, makeReview(), report)).toThrow(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when tests failed", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "test failures" },
        },
      });
      expect(() => policy.assertCanMarkReady(run, makeReview(), report)).toThrow(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ prNumber: 7 });
      expect(() => policy.assertCanMarkReady(run, null, makeExecutionReport())).toThrow(
        expect.objectContaining({ rule: "ready_requires_review" }),
      );
    });

    it("rejects when the review verdict is changes_requested", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).toThrow(
        expect.objectContaining({ rule: "ready_requires_approved_verdict" }),
      );
    });

    it("rejects when there are unresolved blocker findings even though verdict is approved", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
          { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
        ],
      });
      expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).toThrow(
        expect.objectContaining({ rule: "ready_requires_blockers_resolved" }),
      );
    });

    it("allows marking ready when findings exist but none are blockers", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows changes within limits and outside protected paths", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });

    it("rejects when a changed file starts with a protected path prefix", () => {
      const bundle = makeTaskBundle({
        repo: { ...makeTaskBundle().repo, protectedPaths: ["secrets/"] },
      });
      expect(() => policy.assertExecutorPaths(["secrets/keys.json"], bundle)).toThrow(
        expect.objectContaining({ rule: "executor_touched_protected_path" }),
      );
    });

    it("rejects when the number of changed files exceeds maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: { ...makeTaskBundle().constraints, maxFilesChanged: 2 },
      });
      expect(() =>
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      ).toThrow(expect.objectContaining({ rule: "executor_exceeded_max_files" }));
    });

    it("allows exactly maxFilesChanged files (boundary, not exceeding)", () => {
      const bundle = makeTaskBundle({
        constraints: { ...makeTaskBundle().constraints, maxFilesChanged: 2 },
      });
      expect(() => policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });

    it("allows an empty set of changed files", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
