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
    summary: "Executed",
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
    reviewId: "review-1",
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

describe("PolicyEngine.assertCanPlan", () => {
  const engine = new PolicyEngine();

  it("allows planning from Todo", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning (re-plan)", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state", () => {
    const run = makeRun({ state: RunState.Implementing });
    expect(() => engine.assertCanPlan(run)).toThrow(PolicyViolationError);
    try {
      engine.assertCanPlan(run);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      expect((err as PolicyViolationError).message).toContain("Implementing");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("allows execution when Implementing, approved, and plan versions match", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
  });

  it("rejects when state is not Implementing", () => {
    const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    try {
      engine.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
    }
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    const plan = makePlan({ planVersion: 1 });
    try {
      engine.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("rejects when there is no plan artifact", () => {
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
    const plan = makePlan({ planVersion: 1 });
    try {
      engine.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
      expect((err as PolicyViolationError).message).toContain("v1");
      expect((err as PolicyViolationError).message).toContain("v2");
    }
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("allows review when AIReview, has PR, and has execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("rejects when state is not AIReview", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
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
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    try {
      engine.assertCanReview(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("allows remediation when AddressingReview with changes_requested review and findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "a.ts",
          title: "Bug",
          details: "details",
        },
      ],
    });
    expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
  });

  it("rejects when state is not AddressingReview", () => {
    const run = makeRun({ state: RunState.AIReview });
    const review = makeReview({ overallVerdict: "changes_requested" });
    try {
      engine.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_addressing_review_state",
      );
    }
  });

  it("rejects when there is no review artifact", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("rejects when review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "approved" });
    try {
      engine.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_changes_requested_verdict",
      );
      expect((err as PolicyViolationError).message).toContain("approved");
    }
  });

  it("rejects when there are no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    try {
      engine.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
    }
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();
  const passingReport = makeExecutionReport();
  const approvedReview = makeReview({ overallVerdict: "approved", findings: [] });

  it("allows marking ready when all conditions are satisfied", () => {
    const run = makeRun({ prNumber: 7 });
    expect(() => engine.assertCanMarkReady(run, approvedReview, passingReport)).not.toThrow();
  });

  it("rejects when there is no PR number", () => {
    const run = makeRun({ prNumber: null });
    try {
      engine.assertCanMarkReady(run, approvedReview, passingReport);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ prNumber: 7 });
    try {
      engine.assertCanMarkReady(run, approvedReview, null);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
    }
  });

  it("rejects when lint check failed", () => {
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "" },
        typecheck: { status: "pass", details: "" },
        tests: { status: "pass", details: "" },
      },
    });
    try {
      engine.assertCanMarkReady(run, approvedReview, report);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
    }
  });

  it("rejects when typecheck failed", () => {
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "" },
        typecheck: { status: "fail", details: "" },
        tests: { status: "pass", details: "" },
      },
    });
    try {
      engine.assertCanMarkReady(run, approvedReview, report);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
    }
  });

  it("rejects when tests failed", () => {
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "" },
        typecheck: { status: "pass", details: "" },
        tests: { status: "fail", details: "" },
      },
    });
    try {
      engine.assertCanMarkReady(run, approvedReview, report);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
    }
  });

  it("allows a skipped check without treating it as failing", () => {
    const run = makeRun({ prNumber: 7 });
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
    const run = makeRun({ prNumber: 7 });
    try {
      engine.assertCanMarkReady(run, null, passingReport);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });

  it("rejects when review verdict is not approved", () => {
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    try {
      engine.assertCanMarkReady(run, review, passingReport);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      expect((err as PolicyViolationError).message).toContain("changes_requested");
    }
  });

  it("rejects when there are unresolved blocker findings, even with an approved verdict", () => {
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "a.ts",
          title: "Bug",
          details: "details",
        },
        {
          id: "f2",
          severity: "nit",
          type: "style",
          file: "b.ts",
          title: "Nit",
          details: "details",
        },
      ],
    });
    try {
      engine.assertCanMarkReady(run, review, passingReport);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      expect((err as PolicyViolationError).message).toContain("1");
    }
  });

  it("allows marking ready when non-blocker findings remain", () => {
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "suggestion",
          type: "style",
          file: "a.ts",
          title: "Suggestion",
          details: "details",
        },
      ],
    });
    expect(() => engine.assertCanMarkReady(run, review, passingReport)).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("allows changes within limits and outside protected paths", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths(["src/app.ts", "src/util.ts"], bundle)).not.toThrow();
  });

  it("rejects when a changed file starts with a protected path", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp",
        allowedPaths: ["src/"],
        protectedPaths: ["src/secrets/"],
      },
    });
    try {
      engine.assertExecutorPaths(["src/secrets/key.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      expect((err as PolicyViolationError).message).toContain("src/secrets/key.ts");
    }
  });

  it("rejects when the number of changed files exceeds the max", () => {
    const bundle = makeTaskBundle();
    try {
      engine.assertExecutorPaths(["a.ts", "b.ts", "c.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
      expect((err as PolicyViolationError).message).toContain("3");
      expect((err as PolicyViolationError).message).toContain("2");
    }
  });

  it("allows zero changed files", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
  });
});
