import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
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
    planVersion: 0,
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
    summary: "done",
    filesChanged: [],
    checks: {
      lint: { status: "pass" },
      typecheck: { status: "pass" },
      tests: { status: "pass" },
    },
    notes: "",
    ...overrides,
  } as ExecutionReport;
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    overallVerdict: "approved",
    summary: "Looks good",
    findings: [],
    ...overrides,
  } as Review;
}

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test",
      description: "desc",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "main",
      repoPath: "/tmp/repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/generated/"],
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
  } as TaskBundle;
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
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Done }))).toThrow(
        PolicyViolationError,
      );
    });
  });

  describe("assertCanExecute", () => {
    const plan = makePlan({ planVersion: 3 });

    it("passes when implementing, approved, and plan version matches", () => {
      const run = makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 3,
      });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });

    it("rejects when not in Implementing state", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 3 });
      expect(() => engine.assertCanExecute(run, plan)).toThrow(PolicyViolationError);
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      expect(() => engine.assertCanExecute(run, plan)).toThrow(
        /without explicit plan approval/,
      );
    });

    it("rejects when there is no plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      expect(() => engine.assertCanExecute(run, null)).toThrow(/without a plan artifact/);
    });

    it("rejects when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      expect(() => engine.assertCanExecute(run, plan)).toThrow(/version mismatch/);
    });
  });

  describe("assertCanReview", () => {
    it("passes when in AIReview with PR and execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      expect(() =>
        engine.assertCanReview(run, makeExecutionReport()),
      ).not.toThrow();
    });

    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrow(
        PolicyViolationError,
      );
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrow(
        /without an existing PR/,
      );
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      expect(() => engine.assertCanReview(run, null)).toThrow(
        /without a completed execution report/,
      );
    });
  });

  describe("assertCanRemediate", () => {
    const review = makeReview({ overallVerdict: "changes_requested", findings: [{ severity: "important" } as never] });

    it("passes when addressing review with changes_requested and findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });

    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      expect(() => engine.assertCanRemediate(run, review)).toThrow(PolicyViolationError);
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => engine.assertCanRemediate(run, null)).toThrow(/without a review artifact/);
    });

    it("rejects when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() =>
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" })),
      ).toThrow(/must be "changes_requested"/);
    });

    it("rejects when review has no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() =>
        engine.assertCanRemediate(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
        ),
      ).toThrow(/without review findings/);
    });
  });

  describe("assertCanMarkReady", () => {
    it("passes when PR exists, checks are green, and review is approved with no blockers", () => {
      const run = makeRun({ prNumber: 42 });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
      ).not.toThrow();
    });

    it("rejects without a PR", () => {
      const run = makeRun({ prNumber: null });
      expect(() => engine.assertCanMarkReady(run, makeReview(), makeExecutionReport())).toThrow(
        /without an existing PR/,
      );
    });

    it("rejects without an execution report", () => {
      const run = makeRun({ prNumber: 42 });
      expect(() => engine.assertCanMarkReady(run, makeReview(), null)).toThrow(
        /without execution report/,
      );
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "rejects when %s check failed",
      (checkName) => {
        const run = makeRun({ prNumber: 42 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass" },
            typecheck: { status: "pass" },
            tests: { status: "pass" },
            [checkName]: { status: "fail" },
          } as never,
        });
        expect(() => engine.assertCanMarkReady(run, makeReview(), report)).toThrow(
          /failing checks/,
        );
      },
    );

    it("rejects without a review", () => {
      const run = makeRun({ prNumber: 42 });
      expect(() => engine.assertCanMarkReady(run, null, makeExecutionReport())).toThrow(
        /without a review/,
      );
    });

    it("rejects when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 42 });
      expect(() =>
        engine.assertCanMarkReady(
          run,
          makeReview({ overallVerdict: "changes_requested" }),
          makeExecutionReport(),
        ),
      ).toThrow(/must be "approved"/);
    });

    it("rejects when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 42 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [{ severity: "blocker" }, { severity: "important" }] as never,
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).toThrow(
        /1 unresolved blocker findings/,
      );
    });
  });

  describe("assertExecutorPaths", () => {
    it("passes when files are within allowed, non-protected paths and under the limit", () => {
      const bundle = makeBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/foo.ts", "src/bar.ts"], bundle),
      ).not.toThrow();
    });

    it("rejects when a changed file is under a protected path", () => {
      const bundle = makeBundle();
      expect(() => engine.assertExecutorPaths(["src/generated/x.ts"], bundle)).toThrow(
        /modified protected path/,
      );
    });

    it("rejects when the number of changed files exceeds the max", () => {
      const bundle = makeBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
      ).toThrow(/exceeded_max_files|max:/);
    });
  });
});
