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
    score: 1,
    scoreRationale: "",
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
      title: "Title",
      description: "Description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/repo",
      allowedPaths: [],
      protectedPaths: ["infra/", ".github/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 5,
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
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Implementing }))).toThrow(
      PolicyViolationError,
    );
    try {
      engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("allows execution when implementing, approved, with a matching plan version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
  });

  it("rejects execution outside Implementing state", () => {
    const run = makeRun({ state: RunState.Todo, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, makePlan())).toThrow(PolicyViolationError);
  });

  it("rejects execution without explicit plan approval", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    try {
      engine.assertCanExecute(run, makePlan());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("rejects execution without a plan artifact", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    try {
      engine.assertCanExecute(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
    }
  });

  it("rejects execution when plan version does not match approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 3 });
    try {
      engine.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
    }
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("allows review when in AIReview with a PR and an execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("rejects review outside AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 5 });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
    }
  });

  it("rejects review without an existing PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
    }
  });

  it("rejects review without a completed execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    try {
      engine.assertCanReview(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("allows remediation when addressing review with changes-requested findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
  });

  it("rejects remediation outside AddressingReview state", () => {
    const run = makeRun({ state: RunState.AIReview });
    try {
      engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_addressing_review_state",
      );
    }
  });

  it("rejects remediation without a review artifact", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("rejects remediation when the review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "approved" });
    try {
      engine.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_changes_requested_verdict",
      );
    }
  });

  it("rejects remediation when there are no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    try {
      engine.assertCanRemediate(run, review);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
    }
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();

  it("allows marking ready with a PR, green checks, and an approved review with no blockers", () => {
    const run = makeRun({ prNumber: 5 });
    expect(() =>
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
    ).not.toThrow();
  });

  it("rejects without an existing PR", () => {
    const run = makeRun({ prNumber: null });
    try {
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("rejects without an execution report", () => {
    const run = makeRun({ prNumber: 5 });
    try {
      engine.assertCanMarkReady(run, makeReview(), null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
    }
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when the %s check failed",
    (checkName) => {
      const run = makeRun({ prNumber: 5 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
          [checkName]: { status: "fail", details: "boom" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    },
  );

  it("rejects without a review", () => {
    const run = makeRun({ prNumber: 5 });
    try {
      engine.assertCanMarkReady(run, null, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });

  it("rejects when the review verdict is not approved", () => {
    const run = makeRun({ prNumber: 5 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    try {
      engine.assertCanMarkReady(run, review, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
    }
  });

  it("rejects when there are unresolved blocker findings", () => {
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
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      expect((err as PolicyViolationError).message).toContain("1 unresolved blocker");
    }
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("allows changes within file-count limits that do not touch protected paths", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
  });

  it("rejects a change that touches a protected path", () => {
    const bundle = makeTaskBundle();
    try {
      engine.assertExecutorPaths(["infra/terraform.tf"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      expect((err as PolicyViolationError).message).toContain("infra/terraform.tf");
    }
  });

  it("rejects a change exceeding the max files changed", () => {
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

  it("allows zero changed files", () => {
    expect(() => engine.assertExecutorPaths([], makeTaskBundle())).not.toThrow();
  });
});
