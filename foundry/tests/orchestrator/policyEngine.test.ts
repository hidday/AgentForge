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
    summary: "Did the thing",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Reviewed",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
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
  const policy = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning from Todo", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning (re-plan)", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws PolicyViolationError with rule code for any other state", () => {
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
    it("throws when run is not in Implementing state", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      expect(() => policy.assertCanExecute(run, makePlan({ planVersion: 1 }))).toThrow(
        PolicyViolationError,
      );
      try {
        policy.assertCanExecute(run, makePlan({ planVersion: 1 }));
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("throws when approvedPlanVersion is not set (null)", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      try {
        policy.assertCanExecute(run, makePlan({ planVersion: 1 }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("throws when no plan artifact is provided", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        policy.assertCanExecute(run, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("throws when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      try {
        policy.assertCanExecute(run, makePlan({ planVersion: 3 }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v3");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });

    it("passes when Implementing, approved, and plan version matches (boundary: equal versions)", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      expect(() => policy.assertCanExecute(run, makePlan({ planVersion: 2 }))).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("throws when run is not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      try {
        policy.assertCanReview(run, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("throws when there is no PR yet", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        policy.assertCanReview(run, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("throws when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      try {
        policy.assertCanReview(run, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("passes when in AIReview, has PR and an execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("throws when run is not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      try {
        policy.assertCanRemediate(run, review);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("throws when there is no review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        policy.assertCanRemediate(run, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("throws when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved" });
      try {
        policy.assertCanRemediate(run, review);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("throws when review has changes_requested verdict but no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        policy.assertCanRemediate(run, review);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("passes when AddressingReview with changes_requested verdict and >=1 finding", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("throws when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        policy.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("throws when there is no execution report", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        policy.assertCanMarkReady(run, makeReview(), null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "throws when %s check has failed",
      (checkName) => {
        const run = makeRun({ prNumber: 1 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
            [checkName]: { status: "fail", details: "broke" },
          } as ExecutionReport["checks"],
        });
        try {
          policy.assertCanMarkReady(run, makeReview(), report);
          expect.unreachable("should have thrown");
        } catch (err) {
          expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
        }
      },
    );

    it("does NOT treat a 'skip' check status as failing", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "not applicable" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      expect(() => policy.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
    });

    it("throws when there is no review yet", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        policy.assertCanMarkReady(run, null, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("throws when latest review verdict is not approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("throws when there are unresolved blocker findings, even with an approved verdict", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
          { id: "f2", severity: "nit", type: "style", file: "a.ts", title: "t2", details: "d2" },
        ],
      });
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1 unresolved blocker");
      }
    });

    it("passes when PR exists, checks are green, review is approved, and no blockers remain", () => {
      const run = makeRun({ prNumber: 1 });
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
    it("throws when a changed file starts with a protected path prefix", () => {
      const bundle = makeBundle({
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "ai/run-1",
          repoPath: "/tmp",
          allowedPaths: ["src/"],
          protectedPaths: ["src/protected/"],
        },
      });
      try {
        policy.assertExecutorPaths(["src/protected/secrets.ts"], bundle);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("src/protected/secrets.ts");
      }
    });

    it("does not throw when no file matches a protected path prefix", () => {
      const bundle = makeBundle();
      expect(() => policy.assertExecutorPaths(["src/foo.ts"], bundle)).not.toThrow();
    });

    it("throws when the number of changed files exceeds maxFilesChanged", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        policy.assertExecutorPaths(["a.ts", "b.ts", "c.ts"], bundle);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("3");
        expect((err as PolicyViolationError).message).toContain("2");
      }
    });

    it("does not throw at exactly the maxFilesChanged boundary", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() => policy.assertExecutorPaths(["a.ts", "b.ts"], bundle)).not.toThrow();
    });

    it("checks protected-path violations before the file-count limit", () => {
      const bundle = makeBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "ai/run-1",
          repoPath: "/tmp",
          allowedPaths: ["src/"],
          protectedPaths: ["src/protected/"],
        },
      });
      // Two files (exceeds maxFilesChanged=1) and one is protected -- protected
      // path check runs first in the implementation, so that's the error we expect.
      try {
        policy.assertExecutorPaths(["src/protected/a.ts", "src/b.ts"], bundle);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });
  });
});
