/**
 * Shared, stateful mock fixtures for OrchestratorService tests that need to
 * exercise multi-step flows (e.g. runExecution -> runReview -> runRemediation
 * -> markReady) where a single sequence of `mockResolvedValueOnce` calls
 * would be too brittle. Each `buildDeps()` call returns a fresh in-memory
 * "store" (current run + artifacts + events) plus vi.fn() spies for every
 * dependency OrchestratorService expects.
 *
 * This file intentionally does NOT end in `.test.ts` so Vitest does not try
 * to run it as a test suite on its own; it is imported by the real
 * `*.test.ts` files in this directory.
 */
import { vi } from "vitest";
import { RunState } from "../../../src/domain/runState.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../../src/domain/types.js";
import type { Plan } from "../../../src/schemas/plan.js";

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Test issue description",
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

export interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

export function makeStore(runOverrides: Partial<Run> = {}): Store {
  return {
    run: makeRun(runOverrides),
    artifacts: [],
    events: [],
  };
}

let artifactCounter = 0;
let eventCounter = 0;

export function pushArtifact(
  store: Store,
  type: ArtifactType,
  version: number,
  payloadJson: unknown,
): Artifact {
  artifactCounter += 1;
  const artifact: Artifact = {
    id: `artifact-${artifactCounter}`,
    runId: store.run.id,
    type,
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
  store.artifacts.push(artifact);
  return artifact;
}

/**
 * Configures a plannerAgent.run mock to also persist the returned Plan as an
 * artifact in the store, mirroring what the real PlannerAgent does (it
 * writes the Plan artifact itself; OrchestratorService never does). Without
 * this, code paths that immediately re-read the "latest Plan" artifact
 * (e.g. runPlanReview) would find nothing.
 */
export function mockPlannerProducesPlan(
  plannerAgentRun: { mockImplementation: (fn: (...args: unknown[]) => unknown) => unknown },
  store: Store,
  plan: Plan,
): void {
  plannerAgentRun.mockImplementation(() => {
    pushArtifact(store, "Plan", plan.planVersion, plan);
    return Promise.resolve(plan);
  });
}

export function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation((id: string) => {
      if (id !== store.run.id) return Promise.resolve(null);
      return Promise.resolve({ ...store.run });
    }),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => {
      store.run = { ...store.run, ...params } as Run;
      return Promise.resolve({ ...store.run });
    }),
    findByIssueId: vi.fn().mockResolvedValue(null),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      store.run = { ...store.run, state };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Record<string, unknown>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi
      .fn()
      .mockImplementation(
        (params: { runId: string; type: ArtifactType; version: number; payloadJson: unknown }) => {
          const artifact = pushArtifact(store, params.type, params.version, params.payloadJson);
          return Promise.resolve(artifact);
        },
      ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => {
      eventCounter += 1;
      const record: RunEventRecord = {
        id: `event-${eventCounter}`,
        runId: store.run.id,
        eventType: params.eventType as string,
        source: params.source as string,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(record);
      return Promise.resolve(record);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test issue description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
      project: "test-project",
      identifier: "ENG-1",
      url: "https://linear.app/x/issue/ENG-1",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    verifyRepoAccess: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createDraftPR: vi.fn().mockResolvedValue(1),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn().mockResolvedValue([]),
    createPRReviewComment: vi.fn().mockResolvedValue(1),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/test-repo"),
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

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  const deps = {
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
  };

  return {
    deps,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    gitService,
    logger,
    dashboardEmitter,
  };
}
