import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

const engine = new PolicyEngine();

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test/repo",
    branchName: "main",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
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
    steps: [],
    testPlan: "plan",
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
    reviewId: "review-1",
    summary: "looks good",
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
      name: "test/repo",
      defaultBranch: "main",
      workingBranch: "feature",
      repoPath: "/tmp/repo",
      allowedPaths: [],
      protectedPaths: ["infra/"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 2,
      maxDiffLines: 100,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
    ...overrides,
  };
}

describe("PolicyEngine.assertCanPlan", () => {
  it("allows planning from Todo", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state", () => {
    const run = makeRun({ state: RunState.Implementing });
    expect(() => engine.assertCanPlan(run)).toThrow(PolicyViolationError);
    try {
      engine.assertCanPlan(run);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  it("rejects when run is not Implementing", () => {
    const run = makeRun({ state: RunState.Todo, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, makePlan())).toThrow(PolicyViolationError);
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    try {
      engine.assertCanExecute(run, makePlan());
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("rejects when no plan artifact is provided", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    try {
      engine.assertCanExecute(run, null);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
    }
  });

  it("rejects when plan version does not match approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    try {
      engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
    }
  });

  it("allows execution with Implementing state, approval, and matching plan version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).not.toThrow();
  });
});

describe("PolicyEngine.assertCanReview", () => {
  it("rejects when run is not in AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
    }
  });

  it("rejects when there is no PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
    }
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
    try {
      engine.assertCanReview(run, null);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });

  it("allows review when state, PR, and execution report are all present", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 1 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  it("rejects when run is not AddressingReview", () => {
    const run = makeRun({ state: RunState.AIReview });
    try {
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }] }),
      );
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_addressing_review_state");
    }
  });

  it("rejects when there is no review artifact", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, null);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("rejects when review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_changes_requested_verdict",
      );
    }
  });

  it("rejects when review has no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [] }),
      );
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
    }
  });

  it("allows remediation when state, verdict, and findings are present", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    expect(() =>
      engine.assertCanRemediate(
        run,
        makeReview({
          overallVerdict: "changes_requested",
          findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
        }),
      ),
    ).not.toThrow();
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  it("rejects when there is no PR", () => {
    const run = makeRun({ prNumber: null });
    try {
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      engine.assertCanMarkReady(run, makeReview(), null);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
    }
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when %s check failed",
    (checkKey) => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
          [checkKey]: { status: "fail", details: "" },
        } as ExecutionReport["checks"],
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    },
  );

  it("rejects when there is no review", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      engine.assertCanMarkReady(run, null, makeExecutionReport());
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });

  it("rejects when review verdict is not approved", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      engine.assertCanMarkReady(
        run,
        makeReview({ overallVerdict: "changes_requested" }),
        makeExecutionReport(),
      );
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
    }
  });

  it("rejects when there are unresolved blocker findings", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      engine.assertCanMarkReady(
        run,
        makeReview({
          overallVerdict: "approved",
          findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
        }),
        makeExecutionReport(),
      );
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
    }
  });

  it("allows marking ready when PR, green checks, approved review, and no blockers are present", () => {
    const run = makeRun({ prNumber: 1 });
    expect(() =>
      engine.assertCanMarkReady(
        run,
        makeReview({
          overallVerdict: "approved",
          findings: [{ id: "f1", severity: "nit", type: "style", file: "a.ts", title: "t", details: "d" }],
        }),
        makeExecutionReport(),
      ),
    ).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  it("rejects when a changed file is under a protected path", () => {
    try {
      engine.assertExecutorPaths(["infra/deploy.ts"], makeTaskBundle());
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
    }
  });

  it("rejects when more files changed than the configured maximum", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 1,
        maxDiffLines: 100,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    try {
      engine.assertExecutorPaths(["a.ts", "b.ts"], bundle);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
    }
  });

  it("allows changes within the file limit and outside protected paths", () => {
    expect(() => engine.assertExecutorPaths(["src/a.ts"], makeTaskBundle())).not.toThrow();
  });
});
