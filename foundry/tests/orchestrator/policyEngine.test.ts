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
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue",
    repo: "example/repo",
    branchName: "agent/run-1",
    prNumber: 42,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
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
    steps: [],
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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "title",
      description: "desc",
      labels: [],
      priority: 2,
    },
    repo: {
      name: "example/repo",
      defaultBranch: "main",
      workingBranch: "agent/run-1",
      repoPath: "/tmp/repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secrets/"],
    },
    constraints: {
      requiredChecks: ["lint", "typecheck", "tests"],
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
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it.each([RunState.Todo, RunState.Planning])(
      "allows planning when run is in state %s",
      (state) => {
        expect(() => engine.assertCanPlan(makeRun({ state }))).not.toThrow();
      },
    );

    it("throws PolicyViolationError with rule plan_requires_todo_or_planning_state otherwise", () => {
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
    it("allows execution when implementing, approved, and plan version matches", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });

    it("rejects when run is not in Implementing state", () => {
      const run = makeRun({ state: RunState.Todo, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
        expect.objectContaining({ rule: "execute_requires_implementing_state" }),
      );
    });

    it("rejects when approvedPlanVersion is null", () => {
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

    it("approvedPlanVersion of 0 is treated as unset only via == null (0 is a valid approved version)", () => {
      // approvedPlanVersion uses `== null` so 0 should NOT trigger the approval error.
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 0 });
      const plan = makePlan({ planVersion: 0 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("allows review when in AIReview state with a PR and execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "review_requires_ai_review_state" }),
      );
    });

    it("rejects when there is no PR number", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "review_requires_pr" }),
      );
    });

    it("rejects when execution report is missing", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => engine.assertCanReview(run, null)).toThrowError(
        expect.objectContaining({ rule: "review_requires_execution_report" }),
      );
    });
  });

  describe("assertCanRemediate", () => {
    it("allows remediation when addressing review with changes_requested verdict and findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/a.ts",
            title: "bug",
            details: "details",
          },
        ],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });

    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      expect(() =>
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" })),
      ).toThrowError(expect.objectContaining({ rule: "remediate_requires_addressing_review_state" }));
    });

    it("rejects when review is missing", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => engine.assertCanRemediate(run, null)).toThrowError(
        expect.objectContaining({ rule: "remediate_requires_review" }),
      );
    });

    it("rejects when verdict is approved instead of changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
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
    it("allows marking ready when PR exists, checks are green, and review is approved with no blockers", () => {
      const run = makeRun({ prNumber: 7 });
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
      const run = makeRun({ prNumber: 7 });
      expect(() => engine.assertCanMarkReady(run, makeReview(), null)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_execution_report" }),
      );
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "rejects when the %s check failed",
      (check) => {
        const run = makeRun({ prNumber: 7 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
            [check]: { status: "fail", details: "boom" },
          },
        });
        expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrowError(
          expect.objectContaining({ rule: "ready_requires_green_checks" }),
        );
      },
    );

    it("allows a skipped check (only 'fail' blocks readiness)", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
    });

    it("rejects when review is missing", () => {
      const run = makeRun({ prNumber: 7 });
      expect(() => engine.assertCanMarkReady(run, null, makeExecutionReport())).toThrowError(
        expect.objectContaining({ rule: "ready_requires_review" }),
      );
    });

    it("rejects when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).toThrowError(expect.objectContaining({ rule: "ready_requires_approved_verdict" }));
    });

    it("rejects when there are unresolved blocker findings even if verdict is approved", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/a.ts",
            title: "bug",
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
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1 unresolved blocker");
      }
    });

    it("allows marking ready when findings exist but none are blockers", () => {
      const run = makeRun({ prNumber: 7 });
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
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows changes within limits that avoid protected paths", () => {
      const bundle = makeBundle();
      expect(() => engine.assertExecutorPaths(["src/a.ts"], bundle)).not.toThrow();
    });

    it("rejects when a changed file starts with a protected path prefix", () => {
      const bundle = makeBundle();
      try {
        engine.assertExecutorPaths(["src/secrets/key.ts"], bundle);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("src/secrets/key.ts");
      }
    });

    it("rejects when the number of changed files exceeds maxFilesChanged", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).toThrowError(
        expect.objectContaining({ rule: "executor_exceeded_max_files" }),
      );
    });

    it("checks protected paths before the file-count limit (protected-path violation reported even under the limit)", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 5,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["src/secrets/key.ts"], bundle),
      ).toThrowError(expect.objectContaining({ rule: "executor_touched_protected_path" }));
    });

    it("allows exactly maxFilesChanged files (boundary, not exceeding)", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });
  });
});
