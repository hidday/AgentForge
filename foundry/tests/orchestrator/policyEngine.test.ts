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
    summary: "summary",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "do it" }],
    testPlan: "run tests",
    confidence: 0.8,
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
    summary: "looks fine",
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
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Implementing }))).toThrow(
        PolicyViolationError,
      );
    });

    it("rejection carries the plan_requires_todo_or_planning_state rule", () => {
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Done }));
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
        expect((err as PolicyViolationError).message).toContain("Done");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("throws when run is not Implementing", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).toThrow(
        PolicyViolationError,
      );
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("throws when approvedPlanVersion is not set", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      try {
        engine.assertCanExecute(run, makePlan());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("throws when there is no plan artifact", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("throws when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      try {
        engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
        expect((err as PolicyViolationError).message).toContain("v1");
        expect((err as PolicyViolationError).message).toContain("v2");
      }
    });

    it("allows execution when state is Implementing, approval set, and plan version matches", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 3 }))).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("throws when run is not AIReview", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 5 });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("throws when there is no PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("throws when there is no execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      try {
        engine.assertCanReview(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("allows review when state is AIReview, PR exists, and report exists", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("throws when run is not AddressingReview", () => {
      const run = makeRun({ state: RunState.AIReview });
      try {
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }] }));
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("throws when there is no review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("throws when review verdict is not changes_requested", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_changes_requested_verdict",
        );
        expect((err as PolicyViolationError).message).toContain("approved");
      }
    });

    it("throws when review has no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
        );
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("allows remediation when state matches, review present, verdict changes_requested, findings exist", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("throws when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("throws when there is no execution report", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it.each(["lint", "typecheck", "tests"] as const)(
      "throws when %s check fails",
      (checkKey) => {
        const run = makeRun({ prNumber: 5 });
        const report = makeExecutionReport();
        report.checks[checkKey].status = "fail";
        try {
          engine.assertCanMarkReady(run, makeReview(), report);
          expect.unreachable();
        } catch (err) {
          expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
        }
      },
    );

    it("throws when there is no review", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("throws when review verdict is not approved", () => {
      const run = makeRun({ prNumber: 5 });
      try {
        engine.assertCanMarkReady(
          run,
          makeReview({ overallVerdict: "changes_requested" }),
          makeExecutionReport(),
        );
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      }
    });

    it("throws when there are unresolved blocker findings", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
          { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
        ],
      });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
        expect((err as PolicyViolationError).message).toContain("1");
      }
    });

    it("allows marking ready when all conditions are satisfied", () => {
      const run = makeRun({ prNumber: 5 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
        ],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("throws when a changed file starts with a protected path", () => {
      const bundle = makeTaskBundle();
      try {
        engine.assertExecutorPaths(["secrets/keys.json"], bundle);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
        expect((err as PolicyViolationError).message).toContain("secrets/keys.json");
      }
    });

    it("throws when file count exceeds maxFilesChanged", () => {
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
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
        expect((err as PolicyViolationError).message).toContain("2");
        expect((err as PolicyViolationError).message).toContain("1");
      }
    });

    it("allows changes within protected/allowed paths and file count", () => {
      const bundle = makeTaskBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("allows an empty changed-files list", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });
  });
});
