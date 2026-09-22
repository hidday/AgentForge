/**
 * Shared test-support helpers for orchestratorService.*.test.ts files.
 *
 * NOT a test file itself (no *.test.ts suffix -> vitest's `include` glob in
 * vitest.config.ts skips it), just fixtures + a mutable in-memory "store"
 * that backs the injected repository mocks so multi-step orchestrator flows
 * (which call requireRun / transitionAndRecord / findLatestByType many times
 * per method) behave consistently across the whole call.
 */
import { vi } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { Remediation } from "../../src/schemas/remediation.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "Test description",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
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
    reviewId: "plan-rev-1",
    summary: "Looks solid",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All checks green.",
    ...overrides,
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeRemediation(overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was a real bug" },
    ],
    readyForHumanReview: true,
    executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
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
      workingBranch: "ai/run-1",
      repoPath: "/tmp/worktree",
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

let artifactCounter = 0;
export function makeArtifact(params: {
  type: ArtifactType;
  version: number;
  payloadJson: unknown;
  runId?: string;
  createdAt?: Date;
}): Artifact {
  artifactCounter += 1;
  return {
    id: `artifact-${artifactCounter}`,
    runId: params.runId ?? "run-1",
    type: params.type,
    version: params.version,
    payloadJson: params.payloadJson,
    rawText: JSON.stringify(params.payloadJson),
    createdAt: params.createdAt ?? new Date("2026-01-01T00:00:00Z"),
  };
}

export interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

/**
 * In production, plannerAgent.run() persists the Plan artifact itself
 * (out of scope of OrchestratorService). Since the agent is mocked here,
 * wire its resolved value to also push a matching Plan artifact into the
 * store, so a subsequent findLatestByType(runId, "Plan") call (e.g. inside
 * runPlanReview) sees it -- exactly as it would against the real agent.
 */
export function mockPlannerPersists(
  plannerAgent: { run: ReturnType<typeof vi.fn> },
  store: TestStore,
  plan: Plan,
): void {
  plannerAgent.run.mockImplementation(() => {
    store.artifacts.push(
      makeArtifact({ runId: store.run.id, type: "Plan", version: plan.planVersion, payloadJson: plan }),
    );
    return Promise.resolve(plan);
  });
}

/**
 * Analogous to mockPlannerPersists: in production the ExecutorAgent persists
 * the ExecutionReport artifact itself. Wire the mock to do the same so a
 * subsequent findLatestByType(runId, "ExecutionReport") (e.g. inside
 * runReview) sees it.
 */
export function mockExecutorPersists(
  executorAgent: { run: ReturnType<typeof vi.fn> },
  store: TestStore,
  report: ExecutionReport,
  prNumber: number,
): void {
  executorAgent.run.mockImplementation(() => {
    store.artifacts.push(
      makeArtifact({
        runId: store.run.id,
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
      }),
    );
    return Promise.resolve({ report, prNumber });
  });
}

/** Push a pre-baked event straight into the store, bypassing eventRepo.create's
 * auto-incrementing createdAt, for tests that need precise event ordering. */
export function pushEvent(
  store: TestStore,
  params: { eventType: string; source: string; createdAt: Date; payloadJson?: unknown },
): void {
  eventCounter += 1;
  store.events.push({
    id: `event-${eventCounter}`,
    runId: store.run.id,
    eventType: params.eventType,
    source: params.source,
    payloadJson: params.payloadJson ?? null,
    createdAt: params.createdAt,
  });
}

export function createStore(initialRun: Run, artifacts: Artifact[] = []): TestStore {
  return { run: initialRun, artifacts, events: [] };
}

let eventCounter = 0;

/**
 * Builds the full OrchestratorDeps mock object, backed by `store` so that
 * repeated requireRun()/transitionAndRecord()/findLatestByType() calls
 * within a single orchestrator method observe consistent, evolving state.
 */
export function buildDeps(store: TestStore, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation((id: string) => {
      if (id !== store.run.id) return Promise.resolve(null);
      return Promise.resolve({ ...store.run });
    }),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findByIssueId: vi.fn().mockResolvedValue(null),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, partial: Partial<Run>) => {
      store.run = { ...store.run, ...partial };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; type: ArtifactType; version: number; payloadJson: unknown }) => {
        const a = makeArtifact({
          runId: params.runId,
          type: params.type,
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
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
    create: vi.fn().mockImplementation(
      (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
        eventCounter += 1;
        const evt: RunEventRecord = {
          id: `event-${eventCounter}`,
          runId: params.runId,
          eventType: params.eventType,
          source: params.source,
          payloadJson: params.payloadJson ?? null,
          createdAt: new Date(Date.now() + eventCounter),
        };
        store.events.push(evt);
        return Promise.resolve(evt);
      },
    ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
      url: "https://linear.app/team/issue/LIN-1",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/src/foo.ts b/src/foo.ts"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/main-repo"),
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
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
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
