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
    linearIssueId: "li-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "agentforge",
    branchName: "feature/x",
    prNumber: 42,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: "claude-code",
    executorRuntime: "claude-code",
    reviewerRuntime: "codex",
    remediationRuntime: "claude-code",
    workingDirectory: "/repo",
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
    testPlan: "run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "done",
    filesChanged: ["src/a.ts"],
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
    reviewId: "rev-1",
    summary: "looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "title",
      description: "description",
      labels: [],
      priority: 1,
    },
    repo: {
      name: "agentforge",
      defaultBranch: "master",
      workingBranch: "feature/x",
      repoPath: "/repo",
      allowedPaths: ["src/"],
      protectedPaths: ["src/generated/"],
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

  it("allows planning from Todo or Planning", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Done }))).toThrow(
      PolicyViolationError,
    );
    try {
      engine.assertCanPlan(makeRun({ state: RunState.Done }));
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("allows execution when implementing, approved, and plan versions match", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
  });

  it("rejects when not in Implementing state", () => {
    const run = makeRun({ state: RunState.Todo });
    expect(() => engine.assertCanExecute(run, makePlan())).toThrow(PolicyViolationError);
  });

  it("rejects when there is no approved plan version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    expect(() => engine.assertCanExecute(run, makePlan())).toThrowError(
      /without explicit plan approval/,
    );
  });

  it("rejects when there is no plan artifact", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, null)).toThrowError(/without a plan artifact/);
  });

  it("rejects when plan version does not match the approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 1 });
    expect(() => engine.assertCanExecute(run, plan)).toThrowError(/version mismatch/);
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("allows review when in AIReview with a PR and an execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("rejects when not in AIReview state", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrow(
      PolicyViolationError,
    );
  });

  it("rejects when there is no PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).toThrowError(
      /without an existing PR/,
    );
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expect(() => engine.assertCanReview(run, null)).toThrowError(
      /without a completed execution report/,
    );
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("allows remediation when AddressingReview with changes-requested findings", () => {
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
    expect(() => engine.assertCanRemediate(run, makeReview())).toThrow(PolicyViolationError);
  });

  it("rejects when there is no review artifact", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    expect(() => engine.assertCanRemediate(run, null)).toThrowError(/without a review artifact/);
  });

  it("rejects when the review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "approved" });
    expect(() => engine.assertCanRemediate(run, review)).toThrowError(/must be "changes_requested"/);
  });

  it("rejects when there are no review findings", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
    expect(() => engine.assertCanRemediate(run, review)).toThrowError(/without review findings/);
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();

  it("allows marking ready when PR, report, and review are all in good standing", () => {
    const run = makeRun({ prNumber: 1 });
    expect(() =>
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
    ).not.toThrow();
  });

  it("rejects without a PR", () => {
    const run = makeRun({ prNumber: null });
    expect(() => engine.assertCanMarkReady(run, makeReview(), makeExecutionReport())).toThrowError(
      /without an existing PR/,
    );
  });

  it("rejects without an execution report", () => {
    const run = makeRun({ prNumber: 1 });
    expect(() => engine.assertCanMarkReady(run, makeReview(), null)).toThrowError(
      /without execution report/,
    );
  });

  it("rejects when lint, typecheck, or tests failed", () => {
    const run = makeRun({ prNumber: 1 });
    const failingLint = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "" },
        typecheck: { status: "pass", details: "" },
        tests: { status: "pass", details: "" },
      },
    });
    expect(() => engine.assertCanMarkReady(run, makeReview(), failingLint)).toThrowError(
      /with failing checks/,
    );
  });

  it("rejects without a review", () => {
    const run = makeRun({ prNumber: 1 });
    expect(() => engine.assertCanMarkReady(run, null, makeExecutionReport())).toThrowError(
      /without a review/,
    );
  });

  it("rejects when the review verdict is not approved", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    expect(() =>
      engine.assertCanMarkReady(run, review, makeExecutionReport()),
    ).toThrowError(/must be "approved"/);
  });

  it("rejects when there are unresolved blocker findings", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        { id: "f2", severity: "nit", type: "style", file: "a.ts", title: "t2", details: "d2" },
      ],
    });
    expect(() =>
      engine.assertCanMarkReady(run, review, makeExecutionReport()),
    ).toThrowError(/1 unresolved blocker findings/);
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("allows changes within allowed, non-protected paths and under the file limit", () => {
    expect(() => engine.assertExecutorPaths(["src/a.ts"], makeBundle())).not.toThrow();
  });

  it("rejects touching a protected path", () => {
    expect(() =>
      engine.assertExecutorPaths(["src/generated/client.ts"], makeBundle()),
    ).toThrowError(/modified protected path/);
  });

  it("rejects exceeding the max files changed constraint", () => {
    const bundle = makeBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 1,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() =>
      engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle),
    ).toThrowError(/exceeded_max_files|changed 2 files/i);
  });
});
