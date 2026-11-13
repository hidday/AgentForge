import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport, CheckResult } from "../../src/schemas/executionReport.js";
import type { Review, Finding } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
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

function makeCheckResult(status: CheckResult["status"] = "pass"): CheckResult {
  return { status, details: "" };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "summary",
    filesChanged: [],
    checks: {
      lint: makeCheckResult(),
      typecheck: makeCheckResult(),
      tests: makeCheckResult(),
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "nit",
    type: "style",
    file: "src/index.ts",
    title: "title",
    details: "details",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "summary",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "title",
      description: "description",
      labels: [],
      priority: 1,
    },
    repo: {
      name: "repo",
      defaultBranch: "main",
      workingBranch: "main",
      repoPath: "/tmp/repo",
      allowedPaths: [],
      protectedPaths: ["infra/", ".github/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 5,
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

    it("allows planning from Planning (re-plan)", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
    });

    it("denies planning from any other state, e.g. Implementing", () => {
      expect(() => engine.assertCanPlan(makeRun({ state: RunState.Implementing }))).toThrow(
        PolicyViolationError,
      );
    });

    it("denies planning with the correct rule code and message", () => {
      try {
        engine.assertCanPlan(makeRun({ state: RunState.Done }));
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyViolationError);
        const e = err as PolicyViolationError;
        expect(e.rule).toBe("plan_requires_todo_or_planning_state");
        expect(e.message).toContain("Done");
      }
    });
  });

  describe("assertCanExecute", () => {
    it("denies execution when not in Implementing state", () => {
      const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
      }
    });

    it("denies execution without an approved plan version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
      }
    });

    it("denies execution when no plan artifact is present", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
      try {
        engine.assertCanExecute(run, null);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
      }
    });

    it("denies execution when plan version does not match approved version", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
      const plan = makePlan({ planVersion: 1 });
      try {
        engine.assertCanExecute(run, plan);
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as PolicyViolationError;
        expect(e.rule).toBe("execute_plan_version_mismatch");
        expect(e.message).toContain("v1");
        expect(e.message).toContain("v2");
      }
    });

    it("allows execution when state is Implementing, plan is approved, and versions match", () => {
      const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
      const plan = makePlan({ planVersion: 3 });
      expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
    });
  });

  describe("assertCanReview", () => {
    it("denies review when not in AIReview state", () => {
      const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
      }
    });

    it("denies review without an existing PR", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: null });
      try {
        engine.assertCanReview(run, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
      }
    });

    it("denies review without a completed execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      try {
        engine.assertCanReview(run, null);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
      }
    });

    it("allows review when in AIReview state with a PR and an execution report", () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
      expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
    });
  });

  describe("assertCanRemediate", () => {
    it("denies remediation when not in AddressingReview state", () => {
      const run = makeRun({ state: RunState.AIReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [makeFinding()],
      });
      try {
        engine.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe(
          "remediate_requires_addressing_review_state",
        );
      }
    });

    it("denies remediation without a review artifact", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      try {
        engine.assertCanRemediate(run, null);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
      }
    });

    it("denies remediation when review verdict is approved (not changes_requested)", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "approved", findings: [makeFinding()] });
      try {
        engine.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as PolicyViolationError;
        expect(e.rule).toBe("remediate_requires_changes_requested_verdict");
        expect(e.message).toContain("approved");
      }
    });

    it("denies remediation when there are no findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
      try {
        engine.assertCanRemediate(run, review);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
      }
    });

    it("allows remediation when in AddressingReview with changes_requested verdict and findings", () => {
      const run = makeRun({ state: RunState.AddressingReview });
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [makeFinding()],
      });
      expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
    });
  });

  describe("assertCanMarkReady", () => {
    it("denies when there is no PR", () => {
      const run = makeRun({ prNumber: null });
      try {
        engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
      }
    });

    it("denies when there is no execution report", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        engine.assertCanMarkReady(run, makeReview(), null);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
      }
    });

    it("denies when lint check failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: makeCheckResult("fail"),
          typecheck: makeCheckResult(),
          tests: makeCheckResult(),
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("denies when typecheck failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: makeCheckResult(),
          typecheck: makeCheckResult("fail"),
          tests: makeCheckResult(),
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("denies when tests failed", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: makeCheckResult(),
          typecheck: makeCheckResult(),
          tests: makeCheckResult("fail"),
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    });

    it("allows a skipped check (skip is not fail)", () => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: makeCheckResult("skip"),
          typecheck: makeCheckResult(),
          tests: makeCheckResult(),
        },
      });
      expect(() => engine.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
    });

    it("denies when there is no review (review stage must have run)", () => {
      const run = makeRun({ prNumber: 1 });
      try {
        engine.assertCanMarkReady(run, null, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
      }
    });

    it("denies when latest review verdict is not approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({ overallVerdict: "changes_requested" });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as PolicyViolationError;
        expect(e.rule).toBe("ready_requires_approved_verdict");
        expect(e.message).toContain("changes_requested");
      }
    });

    it("denies when there are unresolved blocker findings even if verdict is approved", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "blocker" }), makeFinding({ severity: "nit" })],
      });
      try {
        engine.assertCanMarkReady(run, review, makeExecutionReport());
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as PolicyViolationError;
        expect(e.rule).toBe("ready_requires_blockers_resolved");
        expect(e.message).toContain("1");
      }
    });

    it("allows marking ready when PR exists, checks are green, review is approved and no blockers remain", () => {
      const run = makeRun({ prNumber: 1 });
      const review = makeReview({
        overallVerdict: "approved",
        findings: [makeFinding({ severity: "nit" }), makeFinding({ severity: "suggestion" })],
      });
      expect(() =>
        engine.assertCanMarkReady(run, review, makeExecutionReport()),
      ).not.toThrow();
    });
  });

  describe("assertExecutorPaths", () => {
    it("denies when a changed file starts with a protected path", () => {
      const bundle = makeTaskBundle();
      try {
        engine.assertExecutorPaths(["infra/terraform/main.tf"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as PolicyViolationError;
        expect(e.rule).toBe("executor_touched_protected_path");
        expect(e.message).toContain("infra/terraform/main.tf");
      }
    });

    it("denies when a changed file matches a second protected path entry", () => {
      const bundle = makeTaskBundle();
      try {
        engine.assertExecutorPaths([".github/workflows/ci.yml"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      }
    });

    it("denies when the number of changed files exceeds maxFilesChanged", () => {
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
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
        expect.fail("should have thrown");
      } catch (err) {
        const e = err as PolicyViolationError;
        expect(e.rule).toBe("executor_exceeded_max_files");
        expect(e.message).toContain("3");
        expect(e.message).toContain("2");
      }
    });

    it("allows exactly maxFilesChanged files (boundary, not exceeding)", () => {
      const bundle = makeTaskBundle({
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 2,
          maxDiffLines: 1000,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });

    it("allows no changed files at all", () => {
      const bundle = makeTaskBundle();
      expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
    });

    it("allows files outside protected paths and within the file-count limit", () => {
      const bundle = makeTaskBundle();
      expect(() =>
        engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
      ).not.toThrow();
    });
  });
});
