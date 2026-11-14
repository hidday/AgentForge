import { vi } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
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

export function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "plan-rev-1",
    overallVerdict: "approved",
    summary: "Looks good",
    findings: [],
    ...overrides,
  };
}

export function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
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

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Title", description: "desc", labels: [], priority: 1 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp/run-1",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
    ...overrides,
  };
}

export function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * A runRepo mock that behaves like a tiny in-memory store: `create`,
 * `update`, and `updateState` all mutate (and `findById` reflects) one
 * shared "current run" record, so a method under test that chains several
 * state transitions sees a consistent, evolving run instead of a fresh
 * default object on every call.
 */
export function makeStatefulRunRepo(initial: Run | null = makeRun()) {
  let current: Run | null = initial;
  return {
    findById: vi.fn().mockImplementation(() => Promise.resolve(current)),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation((params: Partial<Run>) => {
      current = makeRun({ ...params, state: RunState.Todo });
      return Promise.resolve(current);
    }),
    findByIssueId: vi.fn().mockResolvedValue(null),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      current = { ...(current ?? makeRun()), state };
      return Promise.resolve(current);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      current = { ...(current ?? makeRun()), ...patch };
      return Promise.resolve(current);
    }),
    findRunsNeedingLinearBackfill: vi.fn().mockResolvedValue([]),
    setCurrent: (run: Run | null) => {
      current = run;
    },
    getCurrent: () => current,
  };
}

/**
 * Builds a full set of mocked OrchestratorService dependencies. Each method
 * resolves to a sensible default; override whichever mocks a given test
 * needs to drive a specific branch.
 */
export function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = makeStatefulRunRepo();

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Title",
      description: "desc",
      branchName: "ai/lin-1",
      state: "Todo",
      labels: [],
      priority: 1,
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    searchIssues: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
  };

  const githubClient = {
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/a b/a"),
    verifyRepoAccess: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createDraftPR: vi.fn().mockResolvedValue(42),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn().mockResolvedValue([]),
  };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
  const executorAgent = {
    run: vi.fn().mockResolvedValue({ report: makeExecutionReport(), prNumber: 42 }),
  };
  const reviewerAgent = { run: vi.fn().mockResolvedValue(makeReview()) };
  const remediationAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "rev-1",
      resolution: [],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    }),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
    emitChatReply: vi.fn(),
  };

  return {
    deps: {
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient,
      githubClient,
      gitService,
      repoRegistry,
      linearSync,
      githubSync,
      plannerAgent,
      planReviewerAgent,
      planReviserAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    logger,
    dashboardEmitter,
  };
}
