import { vi } from "vitest";
import { RunState } from "../../../src/domain/runState.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../../src/domain/types.js";
import type { Plan } from "../../../src/schemas/plan.js";
import type { PlanReview } from "../../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../../src/schemas/executionReport.js";
import type { Review } from "../../../src/schemas/review.js";
import type { Remediation } from "../../../src/schemas/remediation.js";
import type { TaskBundle } from "../../../src/schemas/taskBundle.js";

/**
 * Shared test fixtures + a "storeful" dependency builder for
 * OrchestratorService tests.
 *
 * The store-backed runRepo/artifactRepo/eventRepo below track real state
 * across calls (rather than requiring hand-chained `mockResolvedValueOnce`
 * sequences), so `transitionAndRecord`'s real `transition()` calls succeed
 * naturally as the service progresses a run through the state machine.
 */

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
    reviewId: "plan-review-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the change.",
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
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Real bug" },
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

export function makeArtifact(overrides: Partial<Artifact> & { type: ArtifactType }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version ?? 1}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeRepoEntry(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

export interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

/**
 * Builds a full set of mocked OrchestratorService dependencies backed by an
 * in-memory store for the run/artifacts/events. Real state transitions are
 * exercised through the real `transition()` function (imported directly by
 * orchestratorService.ts), so the store's `run.state` must stay accurate --
 * which it does automatically because `updateState` writes through it.
 */
export function buildStorefulDeps(initialRun: Run) {
  const store: TestStore = { run: initialRun, artifacts: [], events: [] };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation((data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
    findByIssueId: vi.fn().mockResolvedValue([]),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi
      .fn()
      .mockImplementation(
        (params: { runId: string; type: ArtifactType; version: number; payloadJson: unknown; rawText?: string }) => {
          const a: Artifact = {
            id: `artifact-${params.type}-${params.version}-${store.artifacts.length}`,
            runId: params.runId,
            type: params.type,
            version: params.version,
            payloadJson: params.payloadJson,
            rawText: params.rawText ?? JSON.stringify(params.payloadJson),
            createdAt: new Date(),
          };
          store.artifacts.push(a);
          return Promise.resolve(a);
        },
      ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(
        matching.reduce((best, cur) => (cur.version > best.version ? cur : best)),
      );
    }),
  };

  const eventRepo = {
    create: vi
      .fn()
      .mockImplementation(
        (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
          const e: RunEventRecord = {
            id: `event-${store.events.length}`,
            runId: params.runId,
            eventType: params.eventType,
            source: params.source,
            payloadJson: params.payloadJson ?? {},
            createdAt: new Date(),
          };
          store.events.push(e);
          return Promise.resolve(e);
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
      branchName: "ai/lin-1-test-issue",
      state: "Todo",
      labels: [],
      priority: 0,
      url: "https://linear.app/team/issue/LIN-1",
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    searchIssues: vi.fn().mockResolvedValue([]),
    postComment: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(makeRepoEntry()),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/worktree"),
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

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
  };

  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
  const answerResearcherAgent = { run: vi.fn() };

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
  };

  return {
    store,
    deps,
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
    agentSkillRepo,
    distillationAgent,
    answerResearcherAgent,
  };
}

export type Harness = ReturnType<typeof buildStorefulDeps>;

/**
 * The real agents persist their own artifacts (Plan, PlanReview,
 * ExecutionReport, Review, Remediation) through the *same* artifactRepo the
 * orchestrator reads back from. The stubs below reproduce that side effect so
 * orchestrator methods that immediately re-read "the latest X artifact"
 * (runPlanReview, runExecution, runReview, runRemediation, markReady, ...)
 * see consistent state, exactly as they would in production.
 *
 * Each stub is call-sequenced: the Nth call to the underlying agent returns
 * (and persists) the Nth value given, repeating the last value for any
 * further calls.
 */
function sequencer<T>(values: T[]): () => T {
  let i = 0;
  return () => {
    const value = values[Math.min(i, values.length - 1)];
    i++;
    return value;
  };
}

export function stubPlanner(h: Harness, ...plans: Plan[]): void {
  const next = sequencer(plans);
  h.plannerAgent.run.mockImplementation(async () => {
    const plan = next();
    await h.artifactRepo.create({
      runId: h.store.run.id,
      type: "Plan",
      version: plan.planVersion,
      payloadJson: plan,
    });
    return plan;
  });
}

export function stubPlanReviewer(h: Harness, ...reviews: PlanReview[]): void {
  const next = sequencer(reviews);
  let version = 0;
  h.planReviewerAgent.run.mockImplementation(async () => {
    const review = next();
    version++;
    await h.artifactRepo.create({
      runId: h.store.run.id,
      type: "PlanReview",
      version,
      payloadJson: review,
    });
    return review;
  });
}

export function stubPlanReviser(
  h: Harness,
  revisedPlan: Plan,
  revision: {
    originalPlanVersion: number;
    revisedPlanVersion: number;
    reviewId: string;
    dispositions: { findingId: string; status: string; rationale: string }[];
  },
): void {
  h.planReviserAgent.run.mockImplementation(async () => {
    await h.artifactRepo.create({
      runId: h.store.run.id,
      type: "Plan",
      version: revisedPlan.planVersion,
      payloadJson: revisedPlan,
    });
    return { revision, revisedPlan };
  });
}

export function stubExecutor(h: Harness, report: ExecutionReport, prNumber: number): void {
  h.executorAgent.run.mockImplementation(async () => {
    await h.artifactRepo.create({
      runId: h.store.run.id,
      type: "ExecutionReport",
      version: report.executionVersion,
      payloadJson: report,
    });
    return { report, prNumber };
  });
}

export function stubReviewer(h: Harness, review: Review): void {
  h.reviewerAgent.run.mockImplementation(async () => {
    await h.artifactRepo.create({
      runId: h.store.run.id,
      type: "Review",
      version: 1,
      payloadJson: review,
    });
    return review;
  });
}

export function stubRemediation(h: Harness, remediation: Remediation): void {
  h.remediationAgent.run.mockImplementation(async () => {
    await h.artifactRepo.create({
      runId: h.store.run.id,
      type: "ExecutionReport",
      version: remediation.executionReport.executionVersion,
      payloadJson: remediation.executionReport,
    });
    await h.artifactRepo.create({
      runId: h.store.run.id,
      type: "Remediation",
      version: 1,
      payloadJson: remediation,
    });
    return remediation;
  });
}
