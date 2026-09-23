import { vi } from "vitest";
import { RunState } from "../../../src/domain/runState.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../../src/domain/types.js";
import type { Plan } from "../../../src/schemas/plan.js";
import type { TaskBundle } from "../../../src/schemas/taskBundle.js";
import type { ExecutionReport } from "../../../src/schemas/executionReport.js";
import type { Review } from "../../../src/schemas/review.js";
import type { PlanReview } from "../../../src/schemas/planReview.js";
import type { Remediation } from "../../../src/schemas/remediation.js";
import type { ResearchedAnswers } from "../../../src/schemas/researchedAnswers.js";

/**
 * Shared test fixtures/helpers for OrchestratorService tests. Not itself a
 * test file (does not match tests/**\/*.test.ts) — imported by the various
 * orchestratorService.*.test.ts files.
 */

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Test description",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
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
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
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
    reviewId: "plan-review-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Executed",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "good",
    ...overrides,
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "review-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeRemediation(overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "review-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Straightforward" },
    ],
    readyForHumanReview: true,
    executionReport: makeExecutionReport({ executionVersion: 2, score: 0.9 }),
    ...overrides,
  };
}

export function makeResearchedAnswers(overrides: Partial<ResearchedAnswers> = {}): ResearchedAnswers {
  return {
    summary: "Researched",
    answers: [
      {
        questionId: "q1",
        question: "What auth method?",
        answer: "OAuth2",
        confidence: "high",
      },
    ],
    completedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    ...overrides,
  };
}

export function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
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

export function makeLinearIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "LIN-1",
    identifier: "ENG-1",
    title: "Test issue",
    description: "Test description",
    branchName: "hidday/eng-1-test-issue",
    state: "Todo",
    labels: [] as string[],
    priority: 0,
    url: "https://linear.app/x/issue/ENG-1",
    project: undefined,
    team: undefined,
    cycle: undefined,
    ...overrides,
  };
}

export function makeRepoEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-repo",
    directory: "test-repo",
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
    ...overrides,
  };
}

/**
 * A stateful in-memory RunRepository mock. `updateState`/`update` mutate a
 * single tracked run and return the merged result, so tests can assert on
 * real end-to-end state transitions instead of hand-chaining
 * `mockResolvedValueOnce` calls per expected transition.
 */
export function makeStatefulRunRepo(initialRun: Run) {
  let current: Run = { ...initialRun };
  const findById = vi.fn(async () => ({ ...current }));
  const updateState = vi.fn(async (_id: string, newState: RunState) => {
    current = { ...current, state: newState };
    return { ...current };
  });
  const update = vi.fn(async (_id: string, patch: Partial<Run>) => {
    current = { ...current, ...patch };
    return { ...current };
  });
  const create = vi.fn(async () => ({ ...current }));

  return {
    findById,
    findActiveByIssueId: vi.fn(async () => null as Run | null),
    findAll: vi.fn(async () => [] as Run[]),
    create,
    findByIssueId: vi.fn(async () => null as Run | null),
    updateState,
    update,
    getCurrent: () => current,
  };
}

/**
 * A stateful in-memory ArtifactRepository mock keyed by artifact type; the
 * "latest" per type is whichever was created/seeded most recently.
 */
export function makeStatefulArtifactRepo() {
  const store = new Map<string, Artifact[]>();
  let counter = 0;

  function seed(type: ArtifactType, payloadJson: unknown, extra: Partial<Artifact> = {}): Artifact {
    counter++;
    const artifact: Artifact = {
      id: `artifact-${counter}`,
      runId: "run-1",
      type,
      version: 1,
      payloadJson,
      rawText: JSON.stringify(payloadJson),
      createdAt: new Date(),
      ...extra,
    };
    const list = store.get(type) ?? [];
    list.push(artifact);
    store.set(type, list);
    return artifact;
  }

  const create = vi.fn(
    async (params: { runId: string; type: ArtifactType; version: number; payloadJson: unknown; rawText: string }) => {
      counter++;
      const artifact: Artifact = {
        id: `artifact-${counter}`,
        runId: params.runId,
        type: params.type,
        version: params.version,
        payloadJson: params.payloadJson,
        rawText: params.rawText,
        createdAt: new Date(),
      };
      const list = store.get(params.type) ?? [];
      list.push(artifact);
      store.set(params.type, list);
      return artifact;
    },
  );

  const findLatestByType = vi.fn(async (_runId: string, type: string) => {
    const list = store.get(type);
    if (!list || list.length === 0) return null;
    return list[list.length - 1];
  });

  const findByRunId = vi.fn(async () => [...store.values()].flat());

  return { create, findByRunId, findLatestByType, seed, _store: store };
}

export function makeStatefulEventRepo() {
  const events: RunEventRecord[] = [];
  let counter = 0;

  const create = vi.fn(
    async (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      counter++;
      const rec: RunEventRecord = {
        id: `event-${counter}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      events.push(rec);
      return rec;
    },
  );

  const findByRunId = vi.fn(async () => [...events]);

  return { create, findByRunId, _events: events };
}

export function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

export function makeDashboardEmitter() {
  return {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
    emitChatReply: vi.fn(),
  };
}

/**
 * Builds a full OrchestratorService dependency graph with sensible defaults.
 * Pass `overrides` to replace/extend any dependency (e.g. supply a custom
 * `answerResearcherAgent` or `agentSkillRepo`, which are optional deps and
 * default to `undefined`/omitted here).
 */
export function buildFullDeps(initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = makeStatefulRunRepo(initialRun);
  const artifactRepo = makeStatefulArtifactRepo();
  const eventRepo = makeStatefulEventRepo();

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue(makeLinearIssue()),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    searchIssues: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
  };

  const githubClient = {
    verifyRepoAccess: vi.fn().mockResolvedValue(undefined),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createDraftPR: vi.fn().mockResolvedValue(101),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/foo b/foo"),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn().mockResolvedValue([]),
    createPRReviewComment: vi.fn().mockResolvedValue(555),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(makeRepoEntry()),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/main-repo"),
    validateWorkingDirectory: vi.fn().mockReturnValue(undefined),
    getRepoByName: vi.fn().mockReturnValue(makeRepoEntry()),
    getDefaultRepo: vi.fn().mockReturnValue(makeRepoEntry()),
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
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "Fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
  const executorAgent = {
    run: vi.fn().mockResolvedValue({ report: makeExecutionReport(), prNumber: 101 }),
  };
  const reviewerAgent = { run: vi.fn().mockResolvedValue(makeReview()) };
  const remediationAgent = { run: vi.fn().mockResolvedValue(makeRemediation()) };

  const logger = makeLogger();
  const dashboardEmitter = makeDashboardEmitter();

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
