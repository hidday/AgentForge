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
    summary: "Implemented things.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid",
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
      protectedPaths: ["src/generated/"],
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

  it.each([RunState.Todo, RunState.Planning])(
    "allows planning from state %s",
    (state) => {
      expect(() => engine.assertCanPlan(makeRun({ state }))).not.toThrow();
    },
  );

  it("rejects planning from an unrelated state", () => {
    const run = makeRun({ state: RunState.Implementing });
    expect(() => engine.assertCanPlan(run)).toThrow(PolicyViolationError);
    try {
      engine.assertCanPlan(run);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      expect((err as PolicyViolationError).message).toContain("Implementing");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  function validRun(): Run {
    return makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
  }

  it("allows execution when state is Implementing, plan is approved, and versions match", () => {
    expect(() => engine.assertCanExecute(validRun(), makePlan({ planVersion: 2 }))).not.toThrow();
  });

  it("rejects when run is not in the Implementing state", () => {
    const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).toThrowError(
      expect.objectContaining({ rule: "execute_requires_implementing_state" }),
    );
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
      expect.objectContaining({ rule: "execute_requires_explicit_approval" }),
    );
  });

  it("rejects when no plan artifact is provided", () => {
    expect(() => engine.assertCanExecute(validRun(), null)).toThrowError(
      expect.objectContaining({ rule: "execute_requires_plan_artifact" }),
    );
  });

  it("rejects when plan.planVersion does not match approvedPlanVersion", () => {
    const run = validRun();
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 5 }))).toThrowError(
      expect.objectContaining({ rule: "execute_plan_version_mismatch" }),
    );
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  function validRun(): Run {
    return makeRun({ state: RunState.AIReview, prNumber: 42 });
  }

  it("allows review when state is AIReview, a PR exists, and an execution report exists", () => {
    expect(() => engine.assertCanReview(validRun(), makeExecutionReport())).not.toThrow();
  });

  it("rejects when run is not in the AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrowError(
      expect.objectContaining({ rule: "review_requires_ai_review_state" }),
    );
  });

  it("rejects when there is no PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrowError(
      expect.objectContaining({ rule: "review_requires_pr" }),
    );
  });

  it("rejects when there is no execution report", () => {
    expect(() => engine.assertCanReview(validRun(), null)).toThrowError(
      expect.objectContaining({ rule: "review_requires_execution_report" }),
    );
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  function validRun(): Run {
    return makeRun({ state: RunState.AddressingReview });
  }

  function reviewWithFindings(): Review {
    return makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/foo.ts",
          title: "Bug",
          details: "broken",
        },
      ],
    });
  }

  it("allows remediation when state matches, review requests changes, and has findings", () => {
    expect(() => engine.assertCanRemediate(validRun(), reviewWithFindings())).not.toThrow();
  });

  it("rejects when run is not in the AddressingReview state", () => {
    const run = makeRun({ state: RunState.AIReview });
    expect(() => engine.assertCanRemediate(run, reviewWithFindings())).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_addressing_review_state" }),
    );
  });

  it("rejects when there is no review artifact", () => {
    expect(() => engine.assertCanRemediate(validRun(), null)).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_review" }),
    );
  });

  it("rejects when the review verdict is not 'changes_requested'", () => {
    const review = makeReview({ overallVerdict: "approved", findings: [] });
    expect(() => engine.assertCanRemediate(validRun(), review)).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_changes_requested_verdict" }),
    );
  });

  it("rejects when the review has no findings, even with changes_requested verdict", () => {
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    expect(() => engine.assertCanRemediate(validRun(), review)).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_findings" }),
    );
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();

  function validRun(): Run {
    return makeRun({ prNumber: 42 });
  }

  it("allows marking ready when PR exists, checks are green, and review is approved with no blockers", () => {
    expect(() =>
      engine.assertCanMarkReady(validRun(), makeReview(), makeExecutionReport()),
    ).not.toThrow();
  });

  it("rejects when there is no PR", () => {
    const run = makeRun({ prNumber: null });
    expect(() =>
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_pr" }));
  });

  it("rejects when there is no execution report", () => {
    expect(() => engine.assertCanMarkReady(validRun(), makeReview(), null)).toThrowError(
      expect.objectContaining({ rule: "ready_requires_execution_report" }),
    );
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when the %s check has failed",
    (checkName) => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
          [checkName]: { status: "fail", details: "broke" },
        },
      });
      expect(() => engine.assertCanMarkReady(validRun(), makeReview(), report)).toThrowError(
        expect.objectContaining({ rule: "ready_requires_green_checks" }),
      );
    },
  );

  it("rejects when there is no review", () => {
    expect(() =>
      engine.assertCanMarkReady(validRun(), null, makeExecutionReport()),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_review" }));
  });

  it("rejects when the review verdict is not 'approved'", () => {
    const review = makeReview({ overallVerdict: "changes_requested" });
    expect(() =>
      engine.assertCanMarkReady(validRun(), review, makeExecutionReport()),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_approved_verdict" }));
  });

  it("rejects when the approved review still has unresolved blocker findings", () => {
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/foo.ts",
          title: "Still broken",
          details: "unresolved",
        },
      ],
    });
    expect(() =>
      engine.assertCanMarkReady(validRun(), review, makeExecutionReport()),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_blockers_resolved" }));
  });

  it("allows marking ready with non-blocker findings present", () => {
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "src/foo.ts",
          title: "Nit",
          details: "minor",
        },
      ],
    });
    expect(() =>
      engine.assertCanMarkReady(validRun(), review, makeExecutionReport()),
    ).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("allows changes within limits and outside protected paths", () => {
    expect(() =>
      engine.assertExecutorPaths(["src/foo.ts", "src/bar.ts"], makeTaskBundle()),
    ).not.toThrow();
  });

  it("rejects when a changed file is under a protected path", () => {
    expect(() =>
      engine.assertExecutorPaths(["src/generated/client.ts"], makeTaskBundle()),
    ).toThrowError(expect.objectContaining({ rule: "executor_touched_protected_path" }));
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
    expect(() =>
      engine.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle),
    ).toThrowError(expect.objectContaining({ rule: "executor_exceeded_max_files" }));
  });

  it("allows exactly maxFilesChanged files (boundary)", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).not.toThrow();
  });

  it("allows an empty changed-files list", () => {
    expect(() => engine.assertExecutorPaths([], makeTaskBundle())).not.toThrow();
  });
});
