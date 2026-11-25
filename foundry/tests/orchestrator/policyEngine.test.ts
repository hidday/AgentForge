import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { Review } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
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
    summary: "Did the thing",
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
    issue: { id: "LIN-1", title: "Issue", description: "Desc", labels: [], priority: 0 },
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
    definitionOfDone: [],
    ...overrides,
  };
}

describe("PolicyEngine.assertCanPlan", () => {
  const policy = new PolicyEngine();

  it("allows planning when run is Todo", () => {
    expect(() => policy.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning when run is Planning", () => {
    expect(() => policy.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("throws PolicyViolationError with rule code when run is in another state", () => {
    expect.assertions(2);
    try {
      policy.assertCanPlan(makeRun({ state: RunState.Implementing }));
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const policy = new PolicyEngine();

  it("throws when run is not Implementing", () => {
    const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    expect(() => policy.assertCanExecute(run, plan)).toThrowError(PolicyViolationError);
    try {
      policy.assertCanExecute(run, plan);
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
    }
  });

  it("throws when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    const plan = makePlan({ planVersion: 1 });
    try {
      policy.assertCanExecute(run, plan);
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("throws when plan artifact is missing", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    try {
      policy.assertCanExecute(run, null);
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
    }
  });

  it("throws when plan version does not match approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 1 });
    try {
      policy.assertCanExecute(run, plan);
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
      expect((err as Error).message).toContain("v1");
      expect((err as Error).message).toContain("v2");
    }
  });

  it("allows execution when state, approval, and plan version all line up", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
    const plan = makePlan({ planVersion: 3 });
    expect(() => policy.assertCanExecute(run, plan)).not.toThrow();
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const policy = new PolicyEngine();

  it("throws when run is not in AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
    try {
      policy.assertCanReview(run, makeExecutionReport());
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
    }
  });

  it("throws when there is no PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    try {
      policy.assertCanReview(run, makeExecutionReport());
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
    }
  });

  it("throws when there is no execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    try {
      policy.assertCanReview(run, null);
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });

  it("allows review when state, PR, and report are all present", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expect(() => policy.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const policy = new PolicyEngine();

  it("throws when run is not AddressingReview", () => {
    const run = makeRun({ state: RunState.AIReview });
    try {
      policy.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_addressing_review_state");
    }
  });

  it("throws when there is no review artifact", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      policy.assertCanRemediate(run, null);
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("throws when review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      policy.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_changes_requested_verdict",
      );
    }
  });

  it("throws when review has no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    try {
      policy.assertCanRemediate(run, review);
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
    }
  });

  it("allows remediation when state, verdict, and findings are all valid", () => {
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
    expect(() => policy.assertCanRemediate(run, review)).not.toThrow();
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const policy = new PolicyEngine();

  it("throws when there is no PR", () => {
    const run = makeRun({ prNumber: null });
    try {
      policy.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("throws when there is no execution report", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      policy.assertCanMarkReady(run, makeReview(), null);
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
    }
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "throws when %s check failed",
    (checkName) => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
          [checkName]: { status: "fail", details: "boom" },
        } as ExecutionReport["checks"],
      });
      try {
        policy.assertCanMarkReady(run, makeReview(), report);
        expect.unreachable();
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    },
  );

  it("throws when there is no review", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      policy.assertCanMarkReady(run, null, makeExecutionReport());
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });

  it("throws when review verdict is not approved", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    try {
      policy.assertCanMarkReady(run, review, makeExecutionReport());
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
    }
  });

  it("throws when there are unresolved blocker findings", () => {
    const run = makeRun({ prNumber: 1 });
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
      ],
    });
    try {
      policy.assertCanMarkReady(run, review, makeExecutionReport());
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      expect((err as Error).message).toContain("1 unresolved blocker");
    }
  });

  it("allows marking ready when checks pass, review is approved, and no blockers remain", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "nit",
          type: "style",
          file: "a.ts",
          title: "Nit",
          details: "details",
        },
      ],
    });
    expect(() => policy.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const policy = new PolicyEngine();

  it("throws when a changed file is under a protected path", () => {
    const bundle = makeTaskBundle();
    try {
      policy.assertExecutorPaths(["secrets/keys.json"], bundle);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      expect((err as Error).message).toContain("secrets/keys.json");
    }
  });

  it("throws when the number of changed files exceeds maxFilesChanged", () => {
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
      policy.assertExecutorPaths(["src/a.ts", "src/b.ts", "src/c.ts"], bundle);
      expect.unreachable();
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
    }
  });

  it("allows changes within protected-path and file-count limits", () => {
    const bundle = makeTaskBundle();
    expect(() =>
      policy.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
    ).not.toThrow();
  });

  it("allows no changed files at all", () => {
    const bundle = makeTaskBundle();
    expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
  });
});
