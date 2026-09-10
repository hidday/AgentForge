import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review, Finding } from "../../src/schemas/review.js";
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

function makeChecks(overrides: Partial<ExecutionReport["checks"]> = {}): ExecutionReport["checks"] {
  return {
    lint: { status: "pass", details: "" },
    typecheck: { status: "pass", details: "" },
    tests: { status: "pass", details: "" },
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the work",
    filesChanged: ["src/a.ts"],
    checks: makeChecks(),
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid",
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "nit",
    type: "style",
    file: "src/a.ts",
    title: "Nit",
    details: "Minor issue",
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
    issue: { id: "LIN-1", title: "Test issue", description: "Desc", labels: [], priority: 0 },
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

describe("PolicyEngine.assertCanPlan", () => {
  const engine = new PolicyEngine();

  it("allows planning from Todo", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning (retry)", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Implementing }))).toThrow(
      PolicyViolationError,
    );
    try {
      engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      expect((err as PolicyViolationError).message).toContain("Implementing");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("rejects execution outside Implementing state", () => {
    const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).toThrow(
      PolicyViolationError,
    );
  });

  it("rejects execution without an approved plan version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    try {
      engine.assertCanExecute(run, makePlan());
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("rejects execution without a plan artifact", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    try {
      engine.assertCanExecute(run, null);
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
    }
  });

  it("rejects execution when the plan version does not match the approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    try {
      engine.assertCanExecute(run, makePlan({ planVersion: 3 }));
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
      expect((err as PolicyViolationError).message).toContain("v3");
      expect((err as PolicyViolationError).message).toContain("v2");
    }
  });

  it("allows execution when state, approval, and plan version all line up", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 2 }))).not.toThrow();
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("rejects review outside AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 5 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrow(PolicyViolationError);
  });

  it("rejects review without a PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    try {
      engine.assertCanReview(run, makeExecutionReport());
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
    }
  });

  it("rejects review without an execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    try {
      engine.assertCanReview(run, null);
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });

  it("allows review when in AIReview with a PR and execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("rejects remediation outside AddressingReview state", () => {
    const run = makeRun({ state: RunState.AIReview });
    expect(() =>
      engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] })),
    ).toThrow(PolicyViolationError);
  });

  it("rejects remediation without a review artifact", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, null);
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("rejects remediation when the review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_changes_requested_verdict",
      );
    }
  });

  it("rejects remediation when there are no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [] }),
      );
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
    }
  });

  it("allows remediation with changes_requested verdict and at least one finding", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    expect(() =>
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] }),
      ),
    ).not.toThrow();
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();
  const readyRun = () => makeRun({ prNumber: 5 });
  const approvedReview = () => makeReview({ overallVerdict: "approved", findings: [] });

  it("rejects without a PR", () => {
    try {
      engine.assertCanMarkReady(makeRun({ prNumber: null }), approvedReview(), makeExecutionReport());
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("rejects without an execution report", () => {
    try {
      engine.assertCanMarkReady(readyRun(), approvedReview(), null);
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
    }
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when the %s check failed",
    (checkName) => {
      const report = makeExecutionReport({ checks: makeChecks({ [checkName]: { status: "fail", details: "boom" } }) });
      try {
        engine.assertCanMarkReady(readyRun(), approvedReview(), report);
        expect.unreachable("expected assertCanMarkReady to throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    },
  );

  it("allows a skipped check (only 'fail' blocks readiness)", () => {
    const report = makeExecutionReport({ checks: makeChecks({ lint: { status: "skip", details: "" } }) });
    expect(() => engine.assertCanMarkReady(readyRun(), approvedReview(), report)).not.toThrow();
  });

  it("rejects without a review", () => {
    try {
      engine.assertCanMarkReady(readyRun(), null, makeExecutionReport());
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });

  it("rejects when the review verdict is not approved", () => {
    try {
      engine.assertCanMarkReady(
        readyRun(),
        makeReview({ overallVerdict: "changes_requested" }),
        makeExecutionReport(),
      );
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
    }
  });

  it("rejects when there are unresolved blocker findings", () => {
    const review = makeReview({
      overallVerdict: "approved",
      findings: [makeFinding({ severity: "blocker" }), makeFinding({ severity: "nit" })],
    });
    try {
      engine.assertCanMarkReady(readyRun(), review, makeExecutionReport());
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      expect((err as PolicyViolationError).message).toContain("1 unresolved blocker");
    }
  });

  it("allows marking ready when a PR exists, checks pass, and review is approved with no blockers", () => {
    const review = makeReview({
      overallVerdict: "approved",
      findings: [makeFinding({ severity: "nit" }), makeFinding({ severity: "suggestion" })],
    });
    expect(() =>
      engine.assertCanMarkReady(readyRun(), review, makeExecutionReport()),
    ).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("throws when a changed file is under a protected path", () => {
    const bundle = makeTaskBundle();
    try {
      engine.assertExecutorPaths(["secrets/keys.env"], bundle);
      expect.unreachable("expected assertExecutorPaths to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      expect((err as PolicyViolationError).message).toContain("secrets/keys.env");
    }
  });

  it("throws when more files changed than allowed", () => {
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
      expect.unreachable("expected assertExecutorPaths to throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
      expect((err as PolicyViolationError).message).toContain("3 files");
      expect((err as PolicyViolationError).message).toContain("max: 2");
    }
  });

  it("allows changes within protected-path and file-count limits", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
  });

  it("allows an empty file-change set", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
  });

  it("checks protected paths before the file-count limit", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 100,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    try {
      engine.assertExecutorPaths(["secrets/a.env"], bundle);
      expect.unreachable("expected assertExecutorPaths to throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
    }
  });
});
