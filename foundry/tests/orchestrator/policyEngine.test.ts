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
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
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
    summary: "summary",
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
      description: "desc",
      labels: [],
      priority: 1,
    },
    repo: {
      name: "repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp/repo",
      allowedPaths: [],
      protectedPaths: ["infra/", "secrets.env"],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 2,
      maxDiffLines: 1000,
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
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("passes when implementing, approved, and plan version matches", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
  });

  it("rejects when not in Implementing state", () => {
    const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
      expect.objectContaining({ rule: "execute_requires_implementing_state" }),
    );
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
      expect.objectContaining({ rule: "execute_requires_explicit_approval" }),
    );
  });

  it("rejects when there is no plan artifact", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, null)).toThrowError(
      expect.objectContaining({ rule: "execute_requires_plan_artifact" }),
    );
  });

  it("rejects when the plan version does not match the approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 1 });
    expect(() => engine.assertCanExecute(run, plan)).toThrowError(
      expect.objectContaining({ rule: "execute_plan_version_mismatch" }),
    );
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("passes when in AIReview with a PR and an execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("rejects when not in AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
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
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expect(() => engine.assertCanReview(run, null)).toThrowError(
      expect.objectContaining({ rule: "review_requires_execution_report" }),
    );
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("passes when AddressingReview with a changes_requested review containing findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
  });

  it("rejects when not in AddressingReview state", () => {
    const run = makeRun({ state: RunState.AIReview });
    expect(() => engine.assertCanRemediate(run, makeReview())).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_addressing_review_state" }),
    );
  });

  it("rejects when there is no review", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    expect(() => engine.assertCanRemediate(run, null)).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_review" }),
    );
  });

  it("rejects when the review verdict is approved (not changes_requested)", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "approved" });
    expect(() => engine.assertCanRemediate(run, review)).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_changes_requested_verdict" }),
    );
  });

  it("rejects when the review has no findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    expect(() => engine.assertCanRemediate(run, review)).toThrowError(
      expect.objectContaining({ rule: "remediate_requires_findings" }),
    );
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();
  const run = makeRun({ prNumber: 7 });

  it("passes with a PR, green checks, and an approved review with no blockers", () => {
    expect(() =>
      engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), makeExecutionReport()),
    ).not.toThrow();
  });

  it("rejects without a PR", () => {
    expect(() =>
      engine.assertCanMarkReady(
        makeRun({ prNumber: null }),
        makeReview({ overallVerdict: "approved" }),
        makeExecutionReport(),
      ),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_pr" }));
  });

  it("rejects without an execution report", () => {
    expect(() =>
      engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), null),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_execution_report" }));
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when %s check failed",
    (checkName) => {
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
          [checkName]: { status: "fail", details: "boom" },
        },
      });
      expect(() =>
        engine.assertCanMarkReady(run, makeReview({ overallVerdict: "approved" }), report),
      ).toThrowError(expect.objectContaining({ rule: "ready_requires_green_checks" }));
    },
  );

  it("rejects without a review", () => {
    expect(() => engine.assertCanMarkReady(run, null, makeExecutionReport())).toThrowError(
      expect.objectContaining({ rule: "ready_requires_review" }),
    );
  });

  it("rejects when the review verdict is changes_requested", () => {
    expect(() =>
      engine.assertCanMarkReady(
        run,
        makeReview({ overallVerdict: "changes_requested" }),
        makeExecutionReport(),
      ),
    ).toThrowError(expect.objectContaining({ rule: "ready_requires_approved_verdict" }));
  });

  it("rejects when there are unresolved blocker findings even on an approved review", () => {
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        { id: "f2", severity: "nit", type: "style", file: "b.ts", title: "t", details: "d" },
      ],
    });
    expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).toThrowError(
      expect.objectContaining({ rule: "ready_requires_blockers_resolved" }),
    );
  });

  it("passes when findings exist but none are blockers", () => {
    const review = makeReview({
      overallVerdict: "approved",
      findings: [{ id: "f1", severity: "nit", type: "style", file: "b.ts", title: "t", details: "d" }],
    });
    expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("passes when no files are protected and the count is within the max", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths(["src/a.ts"], bundle)).not.toThrow();
  });

  it("rejects when a changed file is under a protected path", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths(["infra/deploy.ts"], bundle)).toThrowError(
      expect.objectContaining({ rule: "executor_touched_protected_path" }),
    );
  });

  it("rejects when the number of changed files exceeds maxFilesChanged", () => {
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 1,
        maxDiffLines: 1000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() => engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle)).toThrowError(
      expect.objectContaining({ rule: "executor_exceeded_max_files" }),
    );
  });

  it("passes with an empty file list", () => {
    const bundle = makeTaskBundle();
    expect(() => engine.assertExecutorPaths([], bundle)).not.toThrow();
  });
});
