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
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
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
    summary: "summary",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "t", description: "d" }],
    testPlan: "run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "done",
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
    summary: "summary",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/work",
      allowedPaths: ["src/"],
      protectedPaths: ["src/protected/"],
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

    it("allows planning from Planning (replanning)", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state with PolicyViolationError and correct rule", () => {
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
        throw new Error("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
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

    it("rejects when run is not Implementing", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
        expect.objectContaining({ rule: "execute_requires_implementing_state" }),
      );
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
        expect.objectContaining({ rule: "execute_requires_explicit_approval" }),
      );
    });

    it("rejects when plan is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, null)).toThrowError(
        expect.objectContaining({ rule: "execute_requires_plan_artifact" }),
      );
    });

    it("rejects when plan version does not match approvedPlanVersion", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      expect(() => engine.assertCanExecute(run, plan)).toThrowError(
        expect.objectContaining({ rule: "execute_plan_version_mismatch" }),
      );
    });
  });

  describe("assertCanReview", () => {
    it("allows review when in AIReview, has a PR, and has an execution report", () => {
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
    it("allows remediation when AddressingReview, review present, changes_requested, with findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
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

    it("rejects when review is null", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => engine.assertCanRemediate(run, null)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_review" }),
      );
    });

    it("rejects when review verdict is approved (not changes_requested)", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      expect(() => engine.assertCanRemediate(run, review)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_changes_requested_verdict" }),
      );
    });

    it("rejects when review has no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      expect(() => engine.assertCanRemediate(run, review)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_findings" }),
      );
    });
  });

  describe("assertCanMarkReady", () => {
    it("allows marking ready when PR exists, checks pass, review approved, no blockers", () => {
      const run = makeRun({ prNumber: 5 });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
      ).not.toThrow();
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
      ).toThrowError(expect.objectContaining({ rule: "ready_requires_pr" }));
    });

    it("rejects when execution report is missing", () => {
      const run = makeRun({ prNumber: 5 });
      expect(() => engine.assertCanMarkReady(run, makeReview(), null)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_execution_report" }),
      );
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "rejects when %s check failed",
      (checkName) => {
        const run = makeRun({ prNumber: 5 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
            [checkName]: { status: "fail", details: "bad" },
          },
        });
        expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrowError(
          expect.objectContaining({ rule: "ready_requires_green_checks" }),
        );
      },
    );

    it("rejects when review is missing", () => {
      const run = makeRun({ prNumber: 5 });
      expect(() => engine.assertCanMarkReady(run, null, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_review" }),
      );
    });

    it("rejects when review verdict is changes_requested (not approved)", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).toThrowError(expect.objectContaining({ rule: "ready_requires_approved_verdict" }));
    });

    it("rejects when there are unresolved blocker findings even if verdict is approved", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).toThrowError(expect.objectContaining({ rule: "ready_requires_blockers_resolved" }));
    });

    it("allows non-blocker findings (suggestion/nit) to pass", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });

    it("checks precedence: missing PR is reported even when other conditions also fail", () => {
      const run = makeRun({ prNumber: null });
      expect(() => engine.assertCanMarkReady(run, null, null)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_pr" }),
      );
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows changes within allowed, unprotected paths and under the file limit", () => {
      const bundle = makeBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("rejects when a changed file starts with a protected path", () => {
      const bundle = makeBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/protected/secret.ts"], bundle),
      ).toThrowError(expect.objectContaining({ rule: "executor_touched_protected_path" }));
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
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      ).toThrowError(expect.objectContaining({ rule: "executor_exceeded_max_files" }));
    });

    it("allows exactly maxFilesChanged files (boundary, not exceeded)", () => {
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
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("allows an empty file list", () => {
      const bundle = makeBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
