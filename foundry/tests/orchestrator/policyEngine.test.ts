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
    issue: { id: "LIN-1", title: "Issue", description: "d", labels: [], priority: 0 },
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
  const policy = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning from Todo", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning (re-planning)", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws PolicyViolationError with the correct rule for any other state", () => {
      try {
        policy.assertCanPlan(makeRun({ state: RunState.Implementing }));
        throw new Error("expected assertCanPlan to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("passes when state is Implementing, plan version matches approval, and plan exists", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 2 });
      expect(() => policy.assertCanExecute(run, plan)).not.toThrow();
    });

    it("throws when state is not Implementing", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      expect(() => policy.assertCanExecute(run, makePlan())).toThrowError(PolicyViolationError);
      try {
        policy.assertCanExecute(run, makePlan());
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("throws when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      try {
        policy.assertCanExecute(run, makePlan());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("throws when the plan artifact is missing", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        policy.assertCanExecute(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("throws when the plan version does not match the approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 3 });
      try {
        policy.assertCanExecute(run, plan);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v3");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });
  });

  describe("assertCanReview", () => {
    it("passes when state is AIReview, PR exists, and execution report exists", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("throws when state is not AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 5 });
      try {
        policy.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("throws when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        policy.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("throws when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      try {
        policy.assertCanReview(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
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

    it("throws when state is not AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      try {
        policy.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("throws when there is no review", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        policy.assertCanRemediate(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("throws when the verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        policy.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("throws when there are no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        policy.assertCanRemediate(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
        );
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });
  });

  describe("assertCanMarkReady", () => {
    it("passes with a PR, green checks, and an approved review with no blockers", () => {
      const run = makeRun({ prNumber: 5 });
      expect(() =>
        policy.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
      ).not.toThrow();
    });

    it("throws when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        policy.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("throws when there is no execution report", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        policy.assertCanMarkReady(run, makeReview(), null);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "throws ready_requires_green_checks when %s fails",
      (checkKey) => {
        const run = makeRun({ prNumber: 5 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
            [checkKey]: { status: "fail", details: "broken" },
          } as unknown as ExecutionReport["checks"],
        });
        try {
          policy.assertCanMarkReady(run, makeReview(), report);
          throw new Error("expected throw");
        } catch (err) {
          expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
        }
      },
    );

    it("throws when there is no review yet (green checks but review stage never ran)", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        policy.assertCanMarkReady(run, null, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("throws when the latest review verdict is not approved", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        policy.assertCanMarkReady(
          run,
          makeReview({ overallVerdict: "changes_requested" }),
          makeExecutionReport(),
        );
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("throws when there are unresolved blocker findings, even with an approved verdict", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1 unresolved blocker");
      }
    });
  });

  describe("assertExecutorPaths", () => {
    it("passes when no protected paths are touched and file count is within budget", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths(["src/a.ts"], bundle)).not.toThrow();
    });

    it("throws executor_touched_protected_path when a changed file starts with a protected path", () => {
      const bundle = makeTaskBundle();
      try {
        policy.assertExecutorPaths(["src/secrets/keys.ts"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("src/secrets/keys.ts");
      }
    });

    it("throws executor_exceeded_max_files when too many files changed", () => {
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
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
      }
    });
  });
});
