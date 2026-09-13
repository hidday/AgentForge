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
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Bug",
        details: "Some bug",
      },
    ],
    overallVerdict: "changes_requested",
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
  const policy = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows Todo state", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows Planning state", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws PolicyViolationError with rule for any other state", () => {
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
      const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanExecute(run, makePlan({ planVersion: 1 }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_implementing_state");
    });

    it("throws when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanExecute(run, makePlan({ planVersion: 1 }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_explicit_approval");
    });

    it("throws when plan artifact is null", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanExecute(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_plan_artifact");
    });

    it("throws when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanExecute(run, makePlan({ planVersion: 1 }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_plan_version_mismatch");
      expect(caught?.message).toContain("v1");
      expect(caught?.message).toContain("v2");
    });

    it("passes when in Implementing state with matching approved plan version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      expect(() => policy.assertCanExecute(run, makePlan({ planVersion: 3 }))).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("throws when run is not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 5 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanReview(run, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_ai_review_state");
    });

    it("throws when run has no PR number", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanReview(run, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_pr");
    });

    it("throws when execution report is null", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanReview(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_execution_report");
    });

    it("passes with AIReview state, PR number, and execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("throws when run is not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanRemediate(run, makeReview());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_addressing_review_state");
    });

    it("throws when review is null", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanRemediate(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_review");
    });

    it("throws when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_changes_requested_verdict");
    });

    it("throws when review has no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanRemediate(run, makeReview({ findings: [] }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_findings");
    });

    it("passes when AddressingReview, changes_requested verdict with findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => policy.assertCanRemediate(run, makeReview())).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("throws when run has no PR number", () => {
      const run = makeRun({ prNumber: null });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_pr");
    });

    it("throws when execution report is null", () => {
      const run = makeRun({ prNumber: 5 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_execution_report");
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "throws when %s check is failing",
      (checkName) => {
        const run = makeRun({ prNumber: 5 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
            [checkName]: { status: "fail", details: "broken" },
          } as ExecutionReport["checks"],
        });
        let caught: PolicyViolationError | undefined;
        try {
          policy.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), report);
        } catch (err) {
          caught = err as PolicyViolationError;
        }
        expect(caught?.rule).toBe("ready_requires_green_checks");
      },
    );

    it("throws when review is null", () => {
      const run = makeRun({ prNumber: 5 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(run, null, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_review");
    });

    it("throws when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 5 });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(
          run,
          makeReview({ overallVerdict: "changes_requested" }),
          makeExecutionReport(),
        );
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_approved_verdict");
    });

    it("throws when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/foo.ts",
            title: "Blocking bug",
            details: "must fix",
          },
        ],
      });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertCanMarkReady(run, review, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_blockers_resolved");
      expect(caught?.message).toContain("1 unresolved blocker");
    });

    it("passes when PR exists, checks green, review approved, no blockers", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({ overallVerdict: "approved", findings: [] });
      expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });

    it("passes when approved with only non-blocker findings", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            file: "src/foo.ts",
            title: "Nit",
            details: "minor",
          },
        ],
      });
      expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("throws when a changed file is under a protected path", () => {
      const bundle = makeTaskBundle();
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertExecutorPaths(["src/secrets/keys.ts"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("executor_touched_protected_path");
      expect(caught?.message).toContain("src/secrets/keys.ts");
    });

    it("throws when files changed exceeds maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 1,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      let caught: PolicyViolationError | undefined;
      try {
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("executor_exceeded_max_files");
      expect(caught?.message).toContain("2 files");
    });

    it("passes when no protected paths touched and under the file limit", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths(["src/a.ts"], bundle)).not.toThrow();
    });

    it("passes with an empty filesChanged list", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
