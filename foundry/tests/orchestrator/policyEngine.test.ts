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
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Reviewed",
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
      protectedPaths: ["src/secure/"],
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

describe("PolicyEngine.assertCanPlan", () => {
  const policy = new PolicyEngine();

  it("allows planning from Todo", () => {
    expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning (retry)", () => {
    expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state", () => {
    try {
      policy.assertCanPlan(makeRun({ state: RunState.Implementing }));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      expect((err as Error).message).toContain("Implementing");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const policy = new PolicyEngine();

  it("passes when state is Implementing, approval matches plan version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => policy.assertCanExecute(run, plan)).not.toThrow();
  });

  it("rejects when run is not in Implementing state", () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    expect(() => policy.assertCanExecute(run, plan)).toThrow(PolicyViolationError);
    try {
      policy.assertCanExecute(run, plan);
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
    }
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    const plan = makePlan({ planVersion: 1 });
    try {
      policy.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("rejects when plan artifact is null", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    try {
      policy.assertCanExecute(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
    }
  });

  it("rejects when plan version does not match approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 3 });
    try {
      policy.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
      expect((err as Error).message).toContain("v3");
      expect((err as Error).message).toContain("v2");
    }
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const policy = new PolicyEngine();

  it("passes when in AIReview with a PR and execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("rejects when not in AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
    try {
      policy.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
    }
  });

  it("rejects when there is no PR number", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    try {
      policy.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
    }
  });

  it("rejects when execution report is null", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    try {
      policy.assertCanReview(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const policy = new PolicyEngine();

  it("passes when AddressingReview with changes_requested review that has findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
  });

  it("rejects when not in AddressingReview state", () => {
    const run = makeRun({ state: RunState.AIReview });
    const review = makeReview({ overallVerdict: "changes_requested" });
    try {
      policy.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_addressing_review_state",
      );
    }
  });

  it("rejects when review is null", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      policy.assertCanRemediate(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("rejects when verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "approved" });
    try {
      policy.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_changes_requested_verdict",
      );
      expect((err as Error).message).toContain("approved");
    }
  });

  it("rejects when there are no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    try {
      policy.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
    }
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const policy = new PolicyEngine();

  it("passes when PR exists, checks are green, review is approved with no blockers", () => {
    const run = makeRun({ prNumber: 7 });
    expect(() =>
      policy.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
    ).not.toThrow();
  });

  it("rejects when there is no PR", () => {
    const run = makeRun({ prNumber: null });
    try {
      policy.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ prNumber: 7 });
    try {
      policy.assertCanMarkReady(run, makeReview(), null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
    }
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when %s check failed",
    (checkName) => {
      const run = makeRun({ prNumber: 7 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
          [checkName]: { status: "fail", details: "broken" },
        },
      });
      try {
        policy.assertCanMarkReady(run, makeReview(), report);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    },
  );

  it("allows a skipped check (only 'fail' blocks readiness)", () => {
    const run = makeRun({ prNumber: 7 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "skip", details: "n/a" },
        tests: { status: "pass", details: "ok" },
      },
    });
    expect(() =>
      policy.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), report),
    ).not.toThrow();
  });

  it("rejects when there is no review", () => {
    const run = makeRun({ prNumber: 7 });
    try {
      policy.assertCanMarkReady(run, null, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });

  it("rejects when the review verdict is not approved", () => {
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    try {
      policy.assertCanMarkReady(run, review, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
      expect((err as Error).message).toContain("changes_requested");
    }
  });

  it("rejects when unresolved blocker findings remain", () => {
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t2", details: "d2" },
      ],
    });
    try {
      policy.assertCanMarkReady(run, review, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      expect((err as Error).message).toContain("1 unresolved blocker");
    }
  });

  it("allows non-blocker findings (suggestion/nit) to remain", () => {
    const run = makeRun({ prNumber: 7 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" },
        { id: "f2", severity: "suggestion", type: "style", file: "b.ts", title: "t2", details: "d2" },
      ],
    });
    expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const policy = new PolicyEngine();

  it("passes when no files are protected and the file count is within the limit", () => {
    const bundle = makeTaskBundle();
    expect(() =>
      policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
    ).not.toThrow();
  });

  it("rejects when a changed file starts with a protected path", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp",
        allowedPaths: ["src/"],
        protectedPaths: ["src/secure/"],
      },
    });
    try {
      policy.assertExecutorPaths(["src/secure/keys.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      expect((err as Error).message).toContain("src/secure/keys.ts");
    }
  });

  it("rejects when the number of changed files exceeds maxFilesChanged", () => {
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
      policy.assertExecutorPaths(["a.ts", "b.ts", "c.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
      expect((err as Error).message).toContain("3 files");
      expect((err as Error).message).toContain("max: 2");
    }
  });

  it("allows a file count exactly at the maxFilesChanged boundary", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() => policy.assertExecutorPaths(["a.ts", "b.ts"], bundle)).not.toThrow();
  });

  it("checks every changed file against protected paths, not just the first", () => {
    const bundle = makeTaskBundle({
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/lin-1",
        repoPath: "/tmp",
        allowedPaths: ["src/"],
        protectedPaths: ["src/secure/"],
      },
    });
    try {
      policy.assertExecutorPaths(["src/a.ts", "src/secure/keys.ts", "src/b.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
    }
  });
});
