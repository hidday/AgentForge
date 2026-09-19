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
    summary: "Done",
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
      protectedPaths: ["src/secrets/"],
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
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows Planning", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects any other state", () => {
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
    it("rejects when run is not Implementing", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, makePlan())).toThrow(PolicyViolationError);
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      try {
        engine.assertCanExecute(run, makePlan());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("rejects when plan is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("rejects when plan version does not match approvedPlanVersion", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
      }
    });

    it("allows execution when Implementing, approved, plan present and versions match", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("rejects when run is not AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrow(PolicyViolationError);
    });

    it("rejects when run has no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("rejects when executionReport is null", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      try {
        engine.assertCanReview(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("allows review when AIReview, PR exists, and report present", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("rejects when run is not AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      expect(() =>
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "x", file: "a.ts", title: "t", details: "d" }] })),
      ).toThrow(PolicyViolationError);
    });

    it("rejects when review is null", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("rejects when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      try {
        engine.assertCanRemediate(run, review);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("rejects when there are no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        engine.assertCanRemediate(run, review);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("allows remediation when AddressingReview, changes_requested, and findings present", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "blocker", type: "x", file: "a.ts", title: "t", details: "d" }],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("rejects when run has no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("rejects when executionReport is null", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "rejects when %s check failed",
      (checkName) => {
        const run = makeRun({ prNumber: 1 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
            [checkName]: { status: "fail", details: "broken" },
          } as ExecutionReport["checks"],
        });
        try {
          engine.assertCanMarkReady(run, makeReview(), report);
          throw new Error("expected throw");
        } catch (err) {
          expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
        }
      },
    );

    it("rejects when review is null", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("rejects when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("rejects when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [{ id: "f1", severity: "blocker", type: "x", file: "a.ts", title: "t", details: "d" }],
      });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1 unresolved blocker findings");
      }
    });

    it("allows marking ready when PR exists, checks pass, review approved, and no blockers", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [{ id: "f1", severity: "nit", type: "x", file: "a.ts", title: "t", details: "d" }],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("rejects when a changed file is under a protected path", () => {
      const bundle = makeTaskBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/secrets/key.ts"], bundle),
      ).toThrow(PolicyViolationError);
      try {
        engine.assertExecutorPaths(["src/secrets/key.ts"], bundle);
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });

    it("rejects when more files changed than maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
      }
    });

    it("allows changes within protected-path and file-count limits", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });

    it("allows zero changed files", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
