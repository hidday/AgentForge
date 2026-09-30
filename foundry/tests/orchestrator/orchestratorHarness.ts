/**
 * Shared, stateful in-memory test harness for OrchestratorService.
 *
 * Unlike the per-file `buildDeps()` helpers (which script each repo call with
 * mockResolvedValueOnce chains), this harness keeps a single Run, an artifact
 * store and an event log in memory, so the service drives the REAL state
 * machine end-to-end. Agent mocks persist the artifacts their real
 * counterparts would persist, which keeps multi-stage flows realistic.
 *
 * Not a test file itself (no `.test.ts` suffix), so vitest does not collect it.
 */
import { vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

export const REPO_ENTRY = {
  name: "test-repo",
  defaultBranch: "main",
  allowedPaths: ["src/"],
  protectedPaths: ["infra/", ".github/"],
  constraints: {
    requiredChecks: [],
    maxFilesChanged: 3,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  },
};

export const ISSUE = {
  id: "LIN-1",
  identifier: "ENG-1",
  title: "Add widget",
  description: "Please add a widget",
  url: "https://linear.app/x/ENG-1",
  branchName: "eng-1-add-widget",
  labels: ["feature"],
  priority: 2,
  project: "proj",
  team: "team",
};

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Please add a widget",
    linearIssueTitle: "Add widget",
    linearIssueUrl: null,
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
    workingDirectory: "/repos/test-repo/.worktrees/run-1",
    latestArtifactVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Implement the widget",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Add file", description: "Create src/widget.ts" }],
    testPlan: "unit tests",
    confidence: 0.8,
    ...overrides,
  };
}

export function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Plan looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented widget",
    filesChanged: ["src/widget.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "12 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All green",
    ...overrides,
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "LGTM",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export interface HarnessOptions {
  run?: Run | null;
  withSkillRepo?: boolean;
  withDistillation?: boolean;
  withResearcher?: boolean;
  withDashboard?: boolean;
  mainRepoPath?: string;
}

export function createHarness(opts: HarnessOptions = {}) {
  let tick = 0;
  const now = (): Date => new Date(Date.UTC(2026, 0, 1) + ++tick * 1000);

  const state: {
    run: Run | null;
    artifacts: Artifact[];
    events: RunEventRecord[];
    comments: { issueId: string; body: string }[];
  } = {
    run: opts.run === undefined ? makeRun() : opts.run,
    artifacts: [],
    events: [],
    comments: [],
  };

  function addArtifact(type: Artifact["type"], payloadJson: unknown, version = 1): Artifact {
    const artifact: Artifact = {
      id: `art-${state.artifacts.length + 1}`,
      runId: state.run?.id ?? "run-1",
      type,
      version,
      payloadJson,
      rawText: JSON.stringify(payloadJson),
      createdAt: now(),
    };
    state.artifacts.push(artifact);
    return artifact;
  }

  function addEvent(eventType: string, payloadJson: unknown = {}): RunEventRecord {
    const evt: RunEventRecord = {
      id: `evt-${state.events.length + 1}`,
      runId: state.run?.id ?? "run-1",
      eventType,
      source: "test",
      payloadJson,
      createdAt: now(),
    };
    state.events.push(evt);
    return evt;
  }

  const runRepo = {
    findById: vi.fn(async (id: string) =>
      state.run && state.run.id === id ? { ...state.run } : null,
    ),
    findActiveByIssueId: vi.fn(async (_issueId: string): Promise<Run | null> => null),
    create: vi.fn(async (data: Partial<Run>) => {
      state.run = makeRun({
        ...data,
        id: "run-new",
        state: RunState.Todo,
        branchName: null,
        planVersion: 0,
      });
      return { ...state.run };
    }),
    update: vi.fn(async (_id: string, patch: Partial<Run>) => {
      state.run = { ...(state.run as Run), ...patch };
      return { ...state.run };
    }),
    updateState: vi.fn(async (_id: string, newState: RunState) => {
      state.run = { ...(state.run as Run), state: newState };
      return { ...state.run };
    }),
  };

  const artifactRepo = {
    create: vi.fn(async (data: { type: Artifact["type"]; payloadJson: unknown; version: number }) =>
      addArtifact(data.type, data.payloadJson, data.version),
    ),
    findLatestByType: vi.fn(async (_runId: string, type: string) => {
      const matches = state.artifacts.filter((a) => a.type === type);
      return matches.length ? matches[matches.length - 1] : null;
    }),
  };

  const eventRepo = {
    create: vi.fn(async (data: { eventType: string; payloadJson?: unknown }) =>
      addEvent(data.eventType, data.payloadJson ?? {}),
    ),
    findByRunId: vi.fn(async () => [...state.events]),
  };

  const linearClient = {
    getIssue: vi.fn(async () => ({ ...ISSUE })),
    postComment: vi.fn(async (issueId: string, body: string) => {
      state.comments.push({ issueId, body });
    }),
    getRelatedContext: vi.fn(async () => ({ blockers: [] as unknown[] })),
  };

  const githubClient = {
    getPRDiff: vi.fn(async () => "diff --git a/src/widget.ts b/src/widget.ts"),
    getDefaultBranch: vi.fn(async () => "main"),
  };

  const gitService = {
    setupRunWorktree: vi.fn(async () => ({
      worktreePath: "/repos/test-repo/.worktrees/run-new",
      branchName: "ai/eng-1-add-widget",
    })),
    assertBranch: vi.fn(async () => undefined),
    commitAndPush: vi.fn(async () => undefined),
    removeWorktree: vi.fn(async () => undefined),
    resolveMainRepoPath: vi.fn(() => opts.mainRepoPath ?? "/repos/test-repo"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn(() => REPO_ENTRY),
    resolveWorkingDirectory: vi.fn(() => "/repos/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn((): typeof REPO_ENTRY | undefined => REPO_ENTRY),
    getDefaultRepo: vi.fn(() => ({ ...REPO_ENTRY, name: "default-repo", defaultBranch: "trunk" })),
  };

  const linearSync = { syncState: vi.fn(async () => undefined) };
  const githubSync = {
    syncState: vi.fn(async () => undefined),
    postReviewFindings: vi.fn(async () => new Map<string, number>([["f1", 1001]])),
    postExecutionReportUpdate: vi.fn(async () => undefined),
    postRemediationResolutions: vi.fn(async () => undefined),
  };

  // Agents persist the artifacts their real counterparts persist.
  const plannerAgent = {
    run: vi.fn(async (_bundle: unknown, _runId: string, o: { planVersionOverride?: number } = {}) => {
      const plan = makePlan({ planVersion: o.planVersionOverride ?? 1 });
      addArtifact("Plan", plan, plan.planVersion);
      return plan;
    }),
  };
  const planReviewerAgent = {
    run: vi.fn(async () => {
      const review = makePlanReview();
      addArtifact("PlanReview", review);
      return review;
    }),
  };
  const planReviserAgent = {
    run: vi.fn(async (plan: Plan) => {
      const revisedPlan = makePlan({ planVersion: (plan?.planVersion ?? 1) + 1 });
      addArtifact("Plan", revisedPlan, revisedPlan.planVersion);
      return {
        revision: {
          dispositions: [{ findingId: "pf1", status: "accepted", rationale: "Good catch" }],
        },
        revisedPlan,
      };
    }),
  };
  const executorAgent = {
    run: vi.fn(async () => {
      const report = makeExecutionReport();
      addArtifact("ExecutionReport", report);
      return { report, prNumber: 77 };
    }),
  };
  const reviewerAgent = {
    run: vi.fn(async () => {
      const review = makeReview();
      addArtifact("Review", review);
      return review;
    }),
  };
  const remediationAgent = {
    run: vi.fn(async () => {
      const executionReport = makeExecutionReport({
        executionVersion: 2,
        score: 0.95,
        scoreRationale: "Fixed",
      });
      addArtifact("ExecutionReport", executionReport, 2);
      // A remediated run is re-reviewed as approved.
      addArtifact("Review", makeReview({ reviewId: "rev-2" }), 2);
      return {
        reviewId: "rev-1",
        resolution: [
          { findingId: "f1", status: "accepted", action: "Fixed the bug", rationale: "Valid" },
        ],
        readyForHumanReview: true,
        executionReport,
      };
    }),
  };

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn(async () => [] as { id: string }[]),
    incrementSuccess: vi.fn(async (id: string) => ({ id, kind: "success" })),
    incrementFailure: vi.fn(async (id: string) => ({ id, kind: "failure" })),
    archiveIfLowUtility: vi.fn(async () => undefined),
  };

  const distillationAgent = { run: vi.fn(async () => undefined) };

  const answerResearcherAgent = {
    run: vi.fn(async () => ({ summary: "", answers: [], completedAt: "" })),
  };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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
    ...(opts.withDashboard === false ? {} : { dashboardEmitter }),
    ...(opts.withSkillRepo ? { agentSkillRepo } : {}),
    ...(opts.withDistillation ? { distillationAgent } : {}),
    ...(opts.withResearcher ? { answerResearcherAgent } : {}),
  };

  const svc = new OrchestratorService(deps as never);

  const eventTypes = (): string[] => state.events.map((e) => e.eventType);
  const currentRun = (): Run => state.run as Run;
  const warnMessages = (): string[] => logger.warn.mock.calls.map((c) => String(c[1]));

  return {
    svc,
    deps,
    state,
    addArtifact,
    addEvent,
    eventTypes,
    currentRun,
    warnMessages,
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
    agentSkillRepo,
    distillationAgent,
    answerResearcherAgent,
    dashboardEmitter,
    logger,
  };
}

export type Harness = ReturnType<typeof createHarness>;
