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
    summary: "Plan",
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
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "",
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
    issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
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
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning from Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows re-planning from Planning", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws a PolicyViolationError with the right rule from any other state", () => {
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Done }));
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("allows execution when Implementing, approved, and plan versions match", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });

    it("rejects when not in Implementing state", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 2 });
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 2 }));
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      try {
        engine.assertCanExecute(run, makePlan());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("rejects when no plan artifact is given", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("rejects when the plan version does not match the approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 3 }));
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
      }
    });
  });

  describe("assertCanReview", () => {
    it("allows review when in AIReview with a PR and an execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("rejects when there is no PR number", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      try {
        engine.assertCanReview(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });
  });

  describe("assertCanRemediate", () => {
    it("allows remediation when AddressingReview with a changes_requested review with findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });

    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      try {
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "nit", type: "x", file: "a", title: "t", details: "d" }] }));
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_addressing_review_state");
      }
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("rejects when the review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("rejects when the review has no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested", findings: [] }));
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });
  });

  describe("assertCanMarkReady", () => {
    it("allows marking ready when PR exists, checks are green, and review is approved with no blockers", () => {
      const run = makeRun({ prNumber: 7 });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
      ).not.toThrow();
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 7 });
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
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
          } as ExecutionReport["checks"],
        });
        try {
          engine.assertCanMarkReady(run, makeReview(), report);
          expect.unreachable();
        } catch (err) {
          expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
        }
      },
    );

    it("rejects when there is no review", () => {
      const run = makeRun({ prNumber: 7 });
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("rejects when the review verdict is not approved", () => {
      const run = makeRun({ prNumber: 7 });
      try {
        engine.assertCanMarkReady(run, makeReview({ overallVerdict: "changes_requested" }), makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("rejects when there are unresolved blocker findings even if approved", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
      });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      }
    });

    it("allows non-blocker findings (nit/suggestion) to pass", () => {
      const run = makeRun({ prNumber: 7 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [{ id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" }],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("allows changes within allowed, non-protected paths and under the file limit", () => {
      expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], makeBundle())).not.toThrow();
    });

    it("rejects a change touching a protected path", () => {
      try {
        engine.assertExecutorPaths(["secrets/key.pem"], makeBundle());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
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
      try {
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
      }
    });
  });
});
