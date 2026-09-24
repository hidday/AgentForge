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
    summary: "Implemented things.",
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
      protectedPaths: ["secrets/"],
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
    it("does not throw when state is Todo", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("does not throw when state is Planning", () => {
      expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("throws PolicyViolationError with rule plan_requires_todo_or_planning_state otherwise", () => {
      try {
        policy.assertCanPlan(makeRun({ state: RunState.Implementing }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toContain("Implementing");
      }
    });
  });

  describe("assertCanExecute", () => {
    const validRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const validPlan = makePlan({ planVersion: 2 });

    it("does not throw when all conditions are satisfied", () => {
      expect(() => policy.assertCanExecute(validRun, validPlan)).not.toThrow();
    });

    it("throws execute_requires_implementing_state when not in Implementing state", () => {
      try {
        policy.assertCanExecute(makeRun({ state: RunState.Planning }), validPlan);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("throws execute_requires_explicit_approval when approvedPlanVersion is null", () => {
      try {
        policy.assertCanExecute(
          makeRun({ state: RunState.Implementing, approvedPlanVersion: null }),
          validPlan,
        );
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("throws execute_requires_plan_artifact when plan is null", () => {
      try {
        policy.assertCanExecute(validRun, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("throws execute_plan_version_mismatch when plan version differs from approvedPlanVersion", () => {
      try {
        policy.assertCanExecute(
          makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 }),
          makePlan({ planVersion: 2 }),
        );
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v2");
        expect((err as PolicyViolationError).message).toContain("v3");
      }
    });

    it("boundary: passes when plan version exactly equals approvedPlanVersion", () => {
      expect(() =>
        policy.assertCanExecute(
          makeRun({ state: RunState.Implementing, approvedPlanVersion: 5 }),
          makePlan({ planVersion: 5 }),
        ),
      ).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    const validRun = makeRun({ state: RunState.AIReview, prNumber: 10 });
    const validReport = makeExecutionReport();

    it("does not throw when all conditions are satisfied", () => {
      expect(() => policy.assertCanReview(validRun, validReport)).not.toThrow();
    });

    it("throws review_requires_ai_review_state when not in AIReview state", () => {
      try {
        policy.assertCanReview(makeRun({ state: RunState.Implementing, prNumber: 10 }), validReport);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("throws review_requires_pr when prNumber is missing", () => {
      try {
        policy.assertCanReview(makeRun({ state: RunState.AIReview, prNumber: null }), validReport);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("throws review_requires_execution_report when executionReport is null", () => {
      try {
        policy.assertCanReview(validRun, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });
  });

  describe("assertCanRemediate", () => {
    const validRun = makeRun({ state: RunState.AddressingReview });
    const validReview = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/foo.ts",
          title: "Bug",
          details: "Real issue",
        },
      ],
    });

    it("does not throw when all conditions are satisfied", () => {
      expect(() => policy.assertCanRemediate(validRun, validReview)).not.toThrow();
    });

    it("throws remediate_requires_addressing_review_state when not in AddressingReview state", () => {
      try {
        policy.assertCanRemediate(makeRun({ state: RunState.AIReview }), validReview);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("throws remediate_requires_review when review is null", () => {
      try {
        policy.assertCanRemediate(validRun, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("throws remediate_requires_changes_requested_verdict when verdict is approved", () => {
      try {
        policy.assertCanRemediate(validRun, makeReview({ overallVerdict: "approved" }));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
      }
    });

    it("throws remediate_requires_findings when findings array is empty", () => {
      try {
        policy.assertCanRemediate(
          validRun,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
        );
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });
  });

  describe("assertCanMarkReady", () => {
    const validRun = makeRun({ prNumber: 10 });
    const validReport = makeExecutionReport();
    const validReview = makeReview({ overallVerdict: "approved", findings: [] });

    it("does not throw when all conditions are satisfied", () => {
      expect(() => policy.assertCanMarkReady(validRun, validReview, validReport)).not.toThrow();
    });

    it("throws ready_requires_pr when prNumber is missing", () => {
      try {
        policy.assertCanMarkReady(makeRun({ prNumber: null }), validReview, validReport);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("throws ready_requires_execution_report when executionReport is null", () => {
      try {
        policy.assertCanMarkReady(validRun, validReview, null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "throws ready_requires_green_checks when %s check fails",
      (checkName) => {
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
            [checkName]: { status: "fail", details: "broken" },
          },
        });
        try {
          policy.assertCanMarkReady(validRun, validReview, report);
          expect.unreachable("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(PolicyViolationError);
          expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
        }
      },
    );

    it("throws ready_requires_review when review is null", () => {
      try {
        policy.assertCanMarkReady(validRun, null, validReport);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("throws ready_requires_approved_verdict when review verdict is changes_requested", () => {
      try {
        policy.assertCanMarkReady(
          validRun,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
          validReport,
        );
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("throws ready_requires_blockers_resolved when there are unresolved blocker findings", () => {
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/foo.ts",
            title: "Blocker",
            details: "Must fix",
          },
        ],
      });
      try {
        policy.assertCanMarkReady(validRun, review, validReport);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1");
      }
    });

    it("does not throw when there are non-blocker findings alongside an approved verdict", () => {
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "minor",
            type: "style",
            file: "src/foo.ts",
            title: "Nit",
            details: "Style nit",
          },
        ],
      });
      expect(() => policy.assertCanMarkReady(validRun, review, validReport)).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("does not throw when files are within limits and outside protected paths", () => {
      const bundle = makeTaskBundle({
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
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        policy.assertExecutorPaths(["src/foo.ts", "src/bar.ts"], bundle),
      ).not.toThrow();
    });

    it("throws executor_touched_protected_path when a changed file starts with a protected path", () => {
      const bundle = makeTaskBundle({
        repo: {
          name: "test-repo",
          defaultBranch: "main",
          workingBranch: "ai/lin-1",
          repoPath: "/tmp",
          allowedPaths: ["src/"],
          protectedPaths: ["secrets/"],
        },
      });
      try {
        policy.assertExecutorPaths(["secrets/keys.json"], bundle);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("secrets/keys.json");
      }
    });

    it("throws executor_exceeded_max_files when more files changed than maxFilesChanged", () => {
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
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("2");
        expect((err as PolicyViolationError).message).toContain("1");
      }
    });

    it("boundary: does not throw when filesChanged.length exactly equals maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("checks protected paths before the file-count limit (protected path violation wins)", () => {
      const bundle = makeTaskBundle({
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
      });
      try {
        policy.assertExecutorPaths(["secrets/keys.json"], bundle);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });

    it("handles an empty filesChanged array without throwing", () => {
      const bundle = makeTaskBundle();
      expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
