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
    requirementsTraceability: "",
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
    summary: "Implementation done.",
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
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: ["secrets/", "infra/prod/"],
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
  const policy = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning from Todo", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning (retry)", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state, with the right rule code", () => {
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanPlan(makeRun({ state: RunState.Implementing }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("plan_requires_todo_or_planning_state");
      expect(caught?.message).toContain("Implementing");
    });
  });

  describe("assertCanExecute", () => {
    it("passes when state is Implementing, approval matches plan version, and plan exists", () => {
      const run = makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 2,
      });
      const plan = makePlan({ planVersion: 2 });
      expect(() => policy.assertCanExecute(run, plan)).not.toThrow();
    });

    it("rejects when state is not Implementing", () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
      const plan = makePlan({ planVersion: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanExecute(run, plan);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_implementing_state");
    });

    it("rejects when approvedPlanVersion is not set (null)", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      const plan = makePlan({ planVersion: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanExecute(run, plan);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_explicit_approval");
    });

    it("rejects when there is no plan artifact (null plan)", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanExecute(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_plan_artifact");
    });

    it("rejects when plan.planVersion does not match run.approvedPlanVersion", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 3 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanExecute(run, plan);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_plan_version_mismatch");
      expect(caught?.message).toContain("v3");
      expect(caught?.message).toContain("v2");
    });

    it("checks state before approval, and approval before plan artifact (ordering)", () => {
      // Wrong state AND no approval AND no plan: should report state error first.
      const run = makeRun({ state: RunState.Todo, approvedPlanVersion: null });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanExecute(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_implementing_state");
    });
  });

  describe("assertCanReview", () => {
    it("passes when state is AIReview, prNumber set, and report exists", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("rejects when state is not AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanReview(run, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_ai_review_state");
    });

    it("rejects when there is no PR number", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanReview(run, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_pr");
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanReview(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_execution_report");
    });

    it("checks state before PR, and PR before execution report (ordering)", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanReview(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_pr");
    });
  });

  describe("assertCanRemediate", () => {
    it("passes when state is AddressingReview, review exists, verdict is changes_requested with findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
    });

    it("rejects when state is not AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_addressing_review_state");
    });

    it("rejects when there is no review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanRemediate(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_review");
    });

    it("rejects when review verdict is approved (not changes_requested)", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_changes_requested_verdict");
      expect(caught?.message).toContain("approved");
    });

    it("rejects when review has changes_requested verdict but zero findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanRemediate(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
        );
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_findings");
    });
  });

  describe("assertCanMarkReady", () => {
    const greenReport = makeExecutionReport();
    const approvedReview = makeReview({ overallVerdict: "approved" });

    it("passes when PR exists, checks are green, and review is approved with no blockers", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => policy.assertCanMarkReady(run, approvedReview, greenReport)).not.toThrow();
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(run, approvedReview, greenReport);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_pr");
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 7 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(run, approvedReview, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_execution_report");
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "rejects when %s check has failed",
      (checkKey) => {
        const run = makeRun({ prNumber: 7 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
            [checkKey]: { status: "fail", details: "broken" },
          },
        });
        let caught: PolicyViolationError | undefined;
        try {
          policy.assertCanMarkReady(run, approvedReview, report);
        } catch (err) {
          caught = err as PolicyViolationError;
        }
        expect(caught?.rule).toBe("ready_requires_green_checks");
      },
    );

    it("allows a 'skip' check status (only 'fail' blocks)", () => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "not applicable" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => policy.assertCanMarkReady(run, approvedReview, report)).not.toThrow();
    });

    it("rejects when there is no review (checks are green but review stage never ran)", () => {
      const run = makeRun({ prNumber: 7 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(run, null, greenReport);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_review");
    });

    it("rejects when latest review verdict is changes_requested", () => {
      const run = makeRun({ prNumber: 7 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
          greenReport,
        );
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_approved_verdict");
    });

    it("rejects when review is approved but still has unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 7 });
      const reviewWithBlocker = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
          { id: "f2", severity: "nit", type: "style", file: "a.ts", title: "t2", details: "d2" },
        ],
      });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(run, reviewWithBlocker, greenReport);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_blockers_resolved");
      expect(caught?.message).toContain("1 unresolved blocker");
    });

    it("allows approved review with only non-blocker findings (important/suggestion/nit)", () => {
      const run = makeRun({ prNumber: 7 });
      const reviewWithNonBlockers = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
          { id: "f2", severity: "suggestion", type: "style", file: "a.ts", title: "t2", details: "d2" },
          { id: "f3", severity: "nit", type: "style", file: "a.ts", title: "t3", details: "d3" },
        ],
      });
      expect(() =>
        policy.assertCanMarkReady(run, reviewWithNonBlockers, greenReport),
      ).not.toThrow();
    });

    it("checks ordering: PR missing takes priority over everything else", () => {
      const run = makeRun({ prNumber: null });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(run, null, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_pr");
    });
  });

  describe("assertExecutorPaths", () => {
    it("passes when no files are protected and file count is within the max", () => {
      const bundle = makeTaskBundle();
      expect(() =>
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("rejects when a changed file starts with a protected path prefix", () => {
      const bundle = makeTaskBundle();
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertExecutorPaths(["src/a.ts", "secrets/key.pem"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("executor_touched_protected_path");
      expect(caught?.message).toContain("secrets/key.pem");
    });

    it("reports the FIRST protected-path violation found when multiple files are protected", () => {
      const bundle = makeTaskBundle();
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertExecutorPaths(["secrets/key.pem", "infra/prod/deploy.yml"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("executor_touched_protected_path");
      expect(caught?.message).toContain("secrets/key.pem");
    });

    it("rejects when filesChanged.length exceeds maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("executor_exceeded_max_files");
      expect(caught?.message).toContain("3 files");
      expect(caught?.message).toContain("max: 2");
    });

    it("boundary: passes when filesChanged.length is exactly maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() => policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });

    it("boundary: rejects when filesChanged.length is exactly one over maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("executor_exceeded_max_files");
    });

    it("protected-path check runs before the max-files check (ordering)", () => {
      // Only 1 file, well within max, but it's protected -- should still throw
      // the protected-path error, not silently pass.
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertExecutorPaths(["secrets/key.pem"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("executor_touched_protected_path");
    });

    it("passes with an empty filesChanged array", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
    });

    it("treats protectedPaths as prefixes, not exact matches (nested file under protected dir)", () => {
      const bundle = makeTaskBundle();
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertExecutorPaths(["infra/prod/nested/deep/file.yml"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("executor_touched_protected_path");
    });
  });
});
