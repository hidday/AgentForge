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
    repo: "acme/widgets",
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
    steps: [{ id: "s1", title: "step", description: "do it" }],
    testPlan: "run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function passingCheck() {
  return { status: "pass" as const, details: "ok" };
}
function failingCheck() {
  return { status: "fail" as const, details: "broken" };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "did the work",
    filesChanged: ["src/a.ts"],
    checks: { lint: passingCheck(), typecheck: passingCheck(), tests: passingCheck() },
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
    summary: "looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Review["findings"][number]> = {}) {
  return {
    id: "f1",
    severity: "important" as const,
    type: "bug",
    file: "src/a.ts",
    title: "issue",
    details: "details",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
    repo: {
      name: "acme/widgets",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secrets/"],
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

    it("allows planning from Planning", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Implementing }))).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("allows execution when Implementing, approved, and plan version matches", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });

    it("rejects when not in Implementing state", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 2 });
      expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 2 }))).toThrowError(
        expect.objectContaining({ rule: "execute_requires_implementing_state" }),
      );
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
        expect.objectContaining({ rule: "execute_requires_explicit_approval" }),
      );
    });

    it("rejects when there is no plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      expect(() => engine.assertCanExecute(run, null)).toThrowError(
        expect.objectContaining({ rule: "execute_requires_plan_artifact" }),
      );
    });

    it("rejects when the plan version does not match the approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 3 });
      expect(() => engine.assertCanExecute(run, plan)).toThrowError(
        expect.objectContaining({ rule: "execute_plan_version_mismatch" }),
      );
    });
  });

  describe("assertCanReview", () => {
    it("allows review when AIReview, has a PR, and has an execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 5 });
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
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => engine.assertCanReview(run, null)).toThrowError(
        expect.objectContaining({ rule: "review_requires_execution_report" }),
      );
    });
  });

  describe("assertCanRemediate", () => {
    it("allows remediation when AddressingReview, changes_requested, with findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });

    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      expect(() => engine.assertCanRemediate(run, review)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_addressing_review_state" }),
      );
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => engine.assertCanRemediate(run, null)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_review" }),
      );
    });

    it("rejects when the review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved", findings: [makeFinding()] });
      expect(() => engine.assertCanRemediate(run, review)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_changes_requested_verdict" }),
      );
    });

    it("rejects when there are no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect(() => engine.assertCanRemediate(run, review)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_findings" }),
      );
    });
  });

  describe("assertCanMarkReady", () => {
    it("allows marking ready when everything is green and approved with no blockers", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport();
      const review = makeReview({ overallVerdict: "approved", findings: [] });
      expect(() => engine.assertCanMarkReady(run, review, report)).not.toThrow();
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      expect(() => engine.assertCanMarkReady(run, makeReview(), makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_pr" }),
      );
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 5 });
      expect(() => engine.assertCanMarkReady(run, makeReview(), null)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_execution_report" }),
      );
    });

    it("rejects when lint check failed", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: { lint: failingCheck(), typecheck: passingCheck(), tests: passingCheck() },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when typecheck failed", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: { lint: passingCheck(), typecheck: failingCheck(), tests: passingCheck() },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when tests failed", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: { lint: passingCheck(), typecheck: passingCheck(), tests: failingCheck() },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ prNumber: 5 });
      expect(() => engine.assertCanMarkReady(run, null, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_review" }),
      );
    });

    it("rejects when the review verdict is not approved", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_approved_verdict" }),
      );
    });

    it("rejects when there are unresolved blocker findings (boundary: 1 blocker)", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "blocker" })],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_blockers_resolved" }),
      );
    });

    it("allows marking ready when findings exist but none are blockers", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "nit" }), makeFinding({ severity: "suggestion" })],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows changes within allowed, unprotected paths and at the file-count limit", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("rejects when a changed file starts with a protected path", () => {
      const bundle = makeTaskBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/secrets/keys.ts"], bundle),
      ).toThrowError(expect.objectContaining({ rule: "executor_touched_protected_path" }));
    });

    it("rejects when the number of changed files exceeds maxFilesChanged (boundary: max+1)", () => {
      const bundle = makeTaskBundle({
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
      ).toThrowError(expect.objectContaining({ rule: "executor_exceeded_max_files" }));
    });

    it("allows exactly maxFilesChanged files (boundary: not over)", () => {
      const bundle = makeTaskBundle({
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

    it("checks protected paths before the file-count limit (protected-path violation reported first)", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["src/secrets/keys.ts", "src/a.ts"], bundle),
      ).toThrowError(expect.objectContaining({ rule: "executor_touched_protected_path" }));
    });
  });
});
