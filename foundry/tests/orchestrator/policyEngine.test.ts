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
    summary: "Done.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "ok",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Bug",
        details: "detail",
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
      description: "desc",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: ["protected/"],
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
  describe("assertCanPlan", () => {
    it("allows Todo state", () => {
      const engine = new PolicyEngine();
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows Planning state", () => {
      const engine = new PolicyEngine();
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects any other state with PolicyViolationError and rule code", () => {
      const engine = new PolicyEngine();
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
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
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_implementing_state");
    });

    it("throws when approvedPlanVersion is not set", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_explicit_approval");
    });

    it("throws when no plan artifact is provided", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanExecute(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_requires_plan_artifact");
    });

    it("throws when plan version does not match approved version", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("execute_plan_version_mismatch");
      expect(caught?.message).toContain("v1");
      expect(caught?.message).toContain("v2");
    });

    it("allows execution when state Implementing, approvedPlanVersion set, and plan version matches", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 3 }))).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("throws when run is not in AIReview state", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanReview(run, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_ai_review_state");
    });

    it("throws when there is no PR number", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanReview(run, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_pr");
    });

    it("throws when there is no execution report", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanReview(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("review_requires_execution_report");
    });

    it("allows review when state AIReview, PR set, and execution report present", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("throws when run is not in AddressingReview state", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.AIReview });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanRemediate(run, makeReview());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_addressing_review_state");
    });

    it("throws when there is no review artifact", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.AddressingReview });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanRemediate(run, null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_review");
    });

    it("throws when review verdict is not changes_requested", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.AddressingReview });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_changes_requested_verdict");
    });

    it("throws when review has no findings", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.AddressingReview });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanRemediate(run, makeReview({ findings: [] }));
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("remediate_requires_findings");
    });

    it("allows remediation when state AddressingReview, review changes_requested with findings", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ state: RunState.AddressingReview });
      expect(() => engine.assertCanRemediate(run, makeReview())).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("throws when there is no PR number", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ prNumber: null });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_pr");
    });

    it("throws when there is no execution report", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ prNumber: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), null);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_execution_report");
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "throws ready_requires_green_checks when %s check has failed",
      (checkName) => {
        const engine = new PolicyEngine();
        const run = makeRun({ prNumber: 1 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
            [checkName]: { status: "fail", details: "broke" },
          } as ExecutionReport["checks"],
        });
        let caught: PolicyViolationError | undefined;
        try {
          engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), report);
        } catch (err) {
          caught = err as PolicyViolationError;
        }
        expect(caught?.rule).toBe("ready_requires_green_checks");
      },
    );

    it("throws when there is no review (even with green checks)", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ prNumber: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_review");
    });

    it("throws when review verdict is not approved", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ prNumber: 1 });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanMarkReady(
          run,
          makeReview({ overallVerdict: "changes_requested" }),
          makeExecutionReport(),
        );
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_approved_verdict");
    });

    it("throws when there are unresolved blocker findings, and includes the count in the message", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/foo.ts",
            title: "Bug",
            details: "detail",
          },
          {
            id: "f2",
            severity: "blocker",
            type: "bug",
            file: "src/bar.ts",
            title: "Bug2",
            details: "detail2",
          },
          {
            id: "f3",
            severity: "nit",
            type: "style",
            file: "src/baz.ts",
            title: "Nit",
            details: "detail3",
          },
        ],
      });
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("ready_requires_blockers_resolved");
      expect(caught?.message).toContain("2 unresolved blocker findings");
    });

    it("allows marking ready when PR set, checks green, review approved, and no blocker findings", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            file: "src/foo.ts",
            title: "Nit",
            details: "detail",
          },
        ],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });

    it("allows marking ready when review has zero findings at all", () => {
      const engine = new PolicyEngine();
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({ overallVerdict: "approved", findings: [] });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("throws when a changed file starts with a protected path", () => {
      const engine = new PolicyEngine();
      const bundle = makeTaskBundle();
      let caught: PolicyViolationError | undefined;
      try {
        engine.assertExecutorPaths(["protected/secrets.ts", "src/foo.ts"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect(caught?.rule).toBe("executor_touched_protected_path");
      expect(caught?.message).toContain("protected/secrets.ts");
    });

    it("throws when the number of files changed exceeds maxFilesChanged", () => {
      const engine = new PolicyEngine();
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
        engine.assertExecutorPaths(["a.ts", "b.ts", "c.ts"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("executor_exceeded_max_files");
      expect(caught?.message).toContain("3 files");
      expect(caught?.message).toContain("max: 2");
    });

    it("checks protected paths before the file count limit (protected path takes priority)", () => {
      const engine = new PolicyEngine();
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
        engine.assertExecutorPaths(["protected/a.ts", "b.ts"], bundle);
      } catch (err) {
        caught = err as PolicyViolationError;
      }
      expect(caught?.rule).toBe("executor_touched_protected_path");
    });

    it("allows changes within allowed count and outside protected paths", () => {
      const engine = new PolicyEngine();
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
    });

    it("allows zero files changed", () => {
      const engine = new PolicyEngine();
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
