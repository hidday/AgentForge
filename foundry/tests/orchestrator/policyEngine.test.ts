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
    branchName: "ai/run-1",
    prNumber: 42,
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
    summary: "Implemented",
    filesChanged: ["src/a.ts"],
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
    summary: "Looks fine",
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

  it("throws PolicyViolationError with correct rule for other states", () => {
    let caught: PolicyViolationError | undefined;
    try {
      engine.assertCanPlan(makeRun({ state: RunState.Done }));
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("plan_requires_todo_or_planning_state");
    expect(caught?.message).toContain("Done");
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("throws when not in Implementing state", () => {
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

  it("throws when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    try {
      engine.assertCanExecute(run, makePlan());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("throws when plan is null", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    try {
      engine.assertCanExecute(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
    }
  });

  it("throws when plan version does not match approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    try {
      engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
      expect((err as PolicyViolationError).message).toContain("v1");
      expect((err as PolicyViolationError).message).toContain("v2");
    }
  });

  it("does not throw when state, approval, plan and version all line up", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 3 }))).not.toThrow();
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("throws when not in AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
    }
  });

  it("throws when run has no PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
    }
  });

  it("throws when no execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
    try {
      engine.assertCanReview(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });

  it("does not throw when state, PR and execution report are present", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("throws when not in AddressingReview state", () => {
    const run = makeRun({ state: RunState.AIReview });
    try {
      engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_addressing_review_state");
    }
  });

  it("throws when there is no review", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("throws when review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_changes_requested_verdict",
      );
    }
  });

  it("throws when review has no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [] }),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
    }
  });

  it("does not throw with a valid changes_requested review with findings", () => {
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

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();

  it("throws when run has no PR", () => {
    const run = makeRun({ prNumber: null });
    try {
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("throws when there is no execution report", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      engine.assertCanMarkReady(run, makeReview(), null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
    }
  });

  it("throws when lint check failed", () => {
    const run = makeRun({ prNumber: 1 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "bad" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    try {
      engine.assertCanMarkReady(run, makeReview(), report);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
    }
  });

  it("throws when typecheck failed", () => {
    const run = makeRun({ prNumber: 1 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "bad" },
        tests: { status: "pass", details: "ok" },
      },
    });
    try {
      engine.assertCanMarkReady(run, makeReview(), report);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
    }
  });

  it("throws when tests failed", () => {
    const run = makeRun({ prNumber: 1 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "fail", details: "bad" },
      },
    });
    try {
      engine.assertCanMarkReady(run, makeReview(), report);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
    }
  });

  it("throws when there is no review", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      engine.assertCanMarkReady(run, null, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });

  it("throws when review verdict is not approved", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      engine.assertCanMarkReady(
        run,
        makeReview({ overallVerdict: "changes_requested" }),
        makeExecutionReport(),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
    }
  });

  it("throws when there are unresolved blocker findings", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    try {
      engine.assertCanMarkReady(run, review, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      expect((err as PolicyViolationError).message).toContain("1");
    }
  });

  it("does not throw when everything is green, approved, and blocker-free", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" },
      ],
    });
    expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("throws when a changed file is under a protected path", () => {
    const bundle = makeTaskBundle();
    try {
      engine.assertExecutorPaths(["secrets/key.txt"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      expect((err as PolicyViolationError).message).toContain("secrets/key.txt");
    }
  });

  it("throws when more files are changed than the configured maximum", () => {
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
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
    }
  });

  it("does not throw for files within allowed paths and under the file-count limit", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths(["src/a.ts"], bundle)).not.toThrow();
  });

  it("does not throw for an empty file list", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
  });
});
