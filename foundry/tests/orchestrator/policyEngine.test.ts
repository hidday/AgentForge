import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { Review } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import { PolicyViolationError } from "../../src/utils/errors.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
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
    steps: [{ id: "s1", title: "t", description: "d" }],
    testPlan: "test plan",
    confidence: 0.8,
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "summary",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "summary",
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

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "title",
      description: "description",
      labels: [],
      priority: 1,
    },
    repo: {
      name: "org/repo",
      defaultBranch: "main",
      workingBranch: "feature/x",
      repoPath: "/repo",
      allowedPaths: [],
      protectedPaths: ["protected/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 3,
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
    it("allows planning from Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state", () => {
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
        expect.unreachable("expected assertCanPlan to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("allows execution when implementing, approved, and plan version matches", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      const plan = makePlan({ planVersion: 1 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });

    it("rejects when run is not in Implementing state", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
        expect.objectContaining({ rule: "execute_requires_implementing_state" }),
      );
    });

    it("rejects when there is no explicit plan approval", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
        expect.objectContaining({ rule: "execute_requires_explicit_approval" }),
      );
    });

    it("rejects when there is no plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, null)).toThrowError(
        expect.objectContaining({ rule: "execute_requires_plan_artifact" }),
      );
    });

    it("rejects when the plan version does not match the approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      expect(() => engine.assertCanExecute(run, plan)).toThrowError(
        expect.objectContaining({ rule: "execute_plan_version_mismatch" }),
      );
    });
  });

  describe("assertCanReview", () => {
    it("allows review when in AIReview with a PR and an execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "review_requires_ai_review_state" }),
      );
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "review_requires_pr" }),
      );
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => engine.assertCanReview(run, null)).toThrowError(
        expect.objectContaining({ rule: "review_requires_execution_report" }),
      );
    });
  });

  describe("assertCanRemediate", () => {
    it("allows remediation when AddressingReview with changes-requested findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });

    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      expect(() => engine.assertCanRemediate(run, makeReview())).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_addressing_review_state" }),
      );
    });

    it("rejects when there is no review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => engine.assertCanRemediate(run, null)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_review" }),
      );
    });

    it("rejects when the review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      expect(() => engine.assertCanRemediate(run, review)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_changes_requested_verdict" }),
      );
    });

    it("rejects when there are no findings to remediate", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect(() => engine.assertCanRemediate(run, review)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_findings" }),
      );
    });
  });

  describe("assertCanMarkReady", () => {
    const greenReport = () => makeExecutionReport();
    const approvedReview = () => makeReview({ overallVerdict: "approved", findings: [] });

    it("allows marking ready when PR exists, checks are green, and review is approved with no blockers", () => {
      const run = makeRun({ prNumber: 1 });
      expect(() => engine.assertCanMarkReady(run, approvedReview(), greenReport())).not.toThrow();
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      expect(() => engine.assertCanMarkReady(run, approvedReview(), greenReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_pr" }),
      );
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 1 });
      expect(() => engine.assertCanMarkReady(run, approvedReview(), null)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_execution_report" }),
      );
    });

    it("rejects when lint failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = greenReport();
      report.checks.lint.status = "fail";
      expect(() => engine.assertCanMarkReady(run, approvedReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when typecheck failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = greenReport();
      report.checks.typecheck.status = "fail";
      expect(() => engine.assertCanMarkReady(run, approvedReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when tests failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = greenReport();
      report.checks.tests.status = "fail";
      expect(() => engine.assertCanMarkReady(run, approvedReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ prNumber: 1 });
      expect(() => engine.assertCanMarkReady(run, null, greenReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_review" }),
      );
    });

    it("rejects when the review verdict is not approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      expect(() => engine.assertCanMarkReady(run, review, greenReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_approved_verdict" }),
      );
    });

    it("rejects when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => engine.assertCanMarkReady(run, review, greenReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_blockers_resolved" }),
      );
    });

    it("allows marking ready when there are only non-blocker findings", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => engine.assertCanMarkReady(run, review, greenReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows changes within allowed paths and under the file limit", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });

    it("rejects when a changed file is under a protected path", () => {
      const bundle = makeTaskBundle({
        repo: {
          name: "org/repo",
          defaultBranch: "main",
          workingBranch: "feature/x",
          repoPath: "/repo",
          allowedPaths: [],
          protectedPaths: ["protected/"],
        },
      });
      expect(() => engine.assertExecutorPaths(["protected/secret.ts"], bundle)).toThrowError(
        expect.objectContaining({ rule: "executor_touched_protected_path" }),
      );
    });

    it("rejects when more files changed than the configured maximum", () => {
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
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).toThrowError(expect.objectContaining({ rule: "executor_exceeded_max_files" }));
    });

    it("allows exactly the maximum number of files changed (boundary)", () => {
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

    it("allows an empty set of changed files", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
