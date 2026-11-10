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
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "feature/x",
    prNumber: 42,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work",
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
    steps: [{ id: "s1", title: "Step 1", description: "do it" }],
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
    reviewId: "review-1",
    summary: "looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "title",
      description: "desc",
      labels: [],
      priority: 1,
    },
    repo: {
      name: "org/repo",
      defaultBranch: "main",
      workingBranch: "feature/x",
      repoPath: "/work",
      allowedPaths: [],
      protectedPaths: ["infra/", ".github/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 3,
      maxDiffLines: 1000,
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

    it("allows planning from Planning (re-entrant planning)", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state, with the correct rule code", () => {
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toContain("Implementing");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("rejects when run is not Implementing", () => {
      const run = makeRun({ state: RunState.Todo, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, makePlan());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("rejects when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      try {
        engine.assertCanExecute(run, makePlan());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("rejects when there is no plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("rejects when the plan version does not match the approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v1");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });

    it("allows execution when state, approval, and plan version all line up", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 2 }))).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("rejects when run is not in AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("rejects when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      try {
        engine.assertCanReview(run, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("allows review when state, PR and execution report are all present", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("rejects when run is not in AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      try {
        engine.assertCanRemediate(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }] }),
        );
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("rejects when there is no review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("rejects when the review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("rejects when the review has no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
        );
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("allows remediation when state, verdict, and findings all qualify", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("rejects when lint has failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "errors" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when typecheck has failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "errors" },
          tests: { status: "pass", details: "ok" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("rejects when tests have failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "errors" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("tolerates skipped checks (skip is not fail)", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "n/a" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
    });

    it("rejects when there is no review (even with green checks)", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("rejects when the review verdict is not approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("rejects when there are unresolved blocker findings even if approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
          { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
        ],
      });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1 unresolved blocker");
      }
    });

    it("allows marking ready when everything is green, approved, and blocker-free", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("rejects when a changed file lives under a protected path", () => {
      const bundle = makeTaskBundle();
      try {
        engine.assertExecutorPaths(["infra/deploy.yaml"], bundle);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("infra/deploy.yaml");
      }
    });

    it("rejects when the number of changed files exceeds the max", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 1000,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        engine.assertExecutorPaths(["a.ts", "b.ts", "c.ts"], bundle);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("3 files");
      }
    });

    it("allows exactly maxFilesChanged files with no protected paths touched", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 1000,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() => engine.assertExecutorPaths(["a.ts", "b.ts"], bundle)).not.toThrow();
    });

    it("allows an empty set of changed files", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
