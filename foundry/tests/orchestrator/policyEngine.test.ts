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
    linearIssueId: "lin-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
    repo: "org/repo",
    branchName: "feature/x",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
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
    steps: [],
    testPlan: "test plan",
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
    score: 0.9,
    scoreRationale: "good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "lin-1",
      title: "title",
      description: "desc",
      labels: [],
      priority: 1,
    },
    repo: {
      name: "org/repo",
      defaultBranch: "main",
      workingBranch: "feature/x",
      repoPath: "/tmp/repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/config/"],
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

function expectPolicyViolation(fn: () => void, rule: string): void {
  try {
    fn();
    expect.fail("expected a PolicyViolationError to be thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe(rule);
  }
}

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("assertCanPlan", () => {
    it("allows planning from Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state", () => {
      expectPolicyViolation(
        () => engine.assertCanPlan(makeRun({ state: RunState.Done })),
        "plan_requires_todo_or_planning_state",
      );
    });
  });

  describe("assertCanExecute", () => {
    it("requires the Implementing state", () => {
      const run = makeRun({ state: RunState.Todo, approvedPlanVersion: 1 });
      expectPolicyViolation(
        () => engine.assertCanExecute(run, makePlan()),
        "execute_requires_implementing_state",
      );
    });

    it("requires explicit plan approval", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      expectPolicyViolation(
        () => engine.assertCanExecute(run, makePlan()),
        "execute_requires_explicit_approval",
      );
    });

    it("requires a plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expectPolicyViolation(
        () => engine.assertCanExecute(run, null),
        "execute_requires_plan_artifact",
      );
    });

    it("requires the plan version to match the approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      expectPolicyViolation(
        () => engine.assertCanExecute(run, makePlan({ planVersion: 1 })),
        "execute_plan_version_mismatch",
      );
    });

    it("succeeds when all conditions are met", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("requires the AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      expectPolicyViolation(
        () => engine.assertCanReview(run, makeExecutionReport()),
        "review_requires_ai_review_state",
      );
    });

    it("requires an existing PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      expectPolicyViolation(
        () => engine.assertCanReview(run, makeExecutionReport()),
        "review_requires_pr",
      );
    });

    it("requires a completed execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expectPolicyViolation(
        () => engine.assertCanReview(run, null),
        "review_requires_execution_report",
      );
    });

    it("succeeds when all conditions are met", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("requires the AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      expectPolicyViolation(
        () => engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" })),
        "remediate_requires_addressing_review_state",
      );
    });

    it("requires a review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expectPolicyViolation(
        () => engine.assertCanRemediate(run, null),
        "remediate_requires_review",
      );
    });

    it("requires the review verdict to be changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expectPolicyViolation(
        () => engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" })),
        "remediate_requires_changes_requested_verdict",
      );
    });

    it("requires at least one finding", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      expectPolicyViolation(
        () =>
          engine.assertCanRemediate(
            run,
            makeReview({ overallVerdict: "changes_requested", findings: [] }),
          ),
        "remediate_requires_findings",
      );
    });

    it("succeeds when all conditions are met", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "src/a.ts",
            title: "bug",
            details: "details",
          },
        ],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("requires an existing PR", () => {
      const run = makeRun({ prNumber: null });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
        "ready_requires_pr",
      );
    });

    it("requires an execution report", () => {
      const run = makeRun({ prNumber: 1 });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, makeReview(), null),
        "ready_requires_execution_report",
      );
    });

    it("requires all checks to be green", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
      });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, makeReview(), report),
        "ready_requires_green_checks",
      );
    });

    it("requires a review to exist", () => {
      const run = makeRun({ prNumber: 1 });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, null, makeExecutionReport()),
        "ready_requires_review",
      );
    });

    it("requires the review verdict to be approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, review, makeExecutionReport()),
        "ready_requires_approved_verdict",
      );
    });

    it("requires no unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/a.ts",
            title: "blocker",
            details: "details",
          },
        ],
      });
      expectPolicyViolation(
        () => engine.assertCanMarkReady(run, review, makeExecutionReport()),
        "ready_requires_blockers_resolved",
      );
    });

    it("succeeds when all conditions are met", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "nit",
            type: "style",
            file: "src/a.ts",
            title: "nit",
            details: "details",
          },
        ],
      });
      expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("rejects changes to a protected path", () => {
      expectPolicyViolation(
        () => engine.assertExecutorPaths(["src/config/env.ts"], makeBundle()),
        "executor_touched_protected_path",
      );
    });

    it("rejects more files changed than the max allowed", () => {
      expectPolicyViolation(
        () =>
          engine.assertExecutorPaths(
            ["src/a.ts", "src/b.ts", "src/c.ts"],
            makeBundle({
              constraints: {
                requiredChecks: [],
                maxFilesChanged: 2,
                maxDiffLines: 500,
                forbiddenPatterns: [],
                mustNotTouch: [],
              },
            }),
          ),
        "executor_exceeded_max_files",
      );
    });

    it("allows changes within protected-path and file-count limits", () => {
      expect(() => engine.assertExecutorPaths(["src/a.ts"], makeBundle())).not.toThrow();
    });
  });
});
