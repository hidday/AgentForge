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
    summary: "summary",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step", description: "desc" }],
    testPlan: "run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "done",
    filesChanged: [],
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

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Issue",
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
      protectedPaths: ["secrets/"],
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
    it("allows planning from Todo", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    });

    it("allows planning from Planning", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("rejects planning from any other state", () => {
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toContain("Implementing");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("rejects when not in Implementing state", () => {
      const run = makeRun({ state: RunState.Todo, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
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

    it("rejects when no plan artifact is provided", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("rejects when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 3 }));
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v3");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });

    it("allows execution when state, approval and plan version all line up", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 2 }))).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("rejects when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("rejects when there is no PR number", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      try {
        engine.assertCanReview(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("allows review when state, PR and execution report are present", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });

    it("treats PR number 0 as falsy (boundary case)", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 0 });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });
  });

  describe("assertCanRemediate", () => {
    it("rejects when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      try {
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("rejects when verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(
          run,
          makeReview({ overallVerdict: "approved", findings: [] }),
        );
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
        expect((err as PolicyViolationError).message).toContain("approved");
      }
    });

    it("rejects when there are no findings despite changes_requested verdict", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
        );
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("allows remediation when verdict is changes_requested with findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/a.ts",
            title: "Bug",
            details: "details",
          },
        ],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    const greenReport = makeExecutionReport();
    const approvedReview = makeReview({ overallVerdict: "approved", findings: [] });

    it("rejects when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, approvedReview, greenReport);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("rejects when there is no execution report", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        engine.assertCanMarkReady(run, approvedReview, null);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "rejects when %s check failed",
      (checkName) => {
        const run = makeRun({ prNumber: 5 });
        const report = makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "" },
            typecheck: { status: "pass", details: "" },
            tests: { status: "pass", details: "" },
            [checkName]: { status: "fail", details: "boom" },
          } as ExecutionReport["checks"],
        });
        try {
          engine.assertCanMarkReady(run, approvedReview, report);
          throw new Error("expected throw");
        } catch (err) {
          expect(err).toBeInstanceOf(PolicyViolationError);
          expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
        }
      },
    );

    it("allows skip status checks through (skip is not fail)", () => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
      });
      expect(() => engine.assertCanMarkReady(run, approvedReview, report)).not.toThrow();
    });

    it("rejects when there is no review", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        engine.assertCanMarkReady(run, null, greenReport);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("rejects when verdict is not approved", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        engine.assertCanMarkReady(run, review, greenReport);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("rejects when there are unresolved blocker findings even if verdict is approved", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "a.ts",
            title: "t",
            details: "d",
          },
          {
            id: "f2",
            severity: "nit",
            type: "style",
            file: "b.ts",
            title: "t2",
            details: "d2",
          },
        ],
      });
      try {
        engine.assertCanMarkReady(run, review, greenReport);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1");
      }
    });

    it("allows marking ready when PR, green checks, approved review with no blockers", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "suggestion",
            type: "style",
            file: "a.ts",
            title: "t",
            details: "d",
          },
        ],
      });
      expect(() => engine.assertCanMarkReady(run, review, greenReport)).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("rejects when a changed file is under a protected path", () => {
      const bundle = makeTaskBundle();
      try {
        engine.assertExecutorPaths(["secrets/key.txt"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("secrets/key.txt");
      }
    });

    it("rejects when number of files changed exceeds maxFilesChanged", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("3");
        expect((err as PolicyViolationError).message).toContain("2");
      }
    });

    it("allows changes within protected-path and max-files limits", () => {
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
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("boundary: exactly maxFilesChanged files is allowed", () => {
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
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("checks protected paths before the file-count limit (protected path wins)", () => {
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
          maxFilesChanged: 100,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      try {
        engine.assertExecutorPaths(["secrets/key.txt"], bundle);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });

    it("allows an empty set of changed files", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
