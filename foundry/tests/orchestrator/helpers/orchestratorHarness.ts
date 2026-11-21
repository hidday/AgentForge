/**
 * Shared, stateful test harness for OrchestratorService.
 *
 * Unlike a pure call-recording mock, the fakes here keep a small in-memory
 * store (the run row, artifacts and events) so the orchestrator's multi-step
 * flows (plan -> review -> revise, execute -> review -> remediate, ...) observe
 * the same post-conditions they would against the real repositories. Fake
 * agents mirror the production agents' side effect of persisting their output
 * artifacts (Plan, PlanReview, ExecutionReport, Review, Remediation, ...).
 *
 * Timestamps come from a deterministic monotonically increasing clock so
 * ordering-sensitive logic (e.g. runExecution crash recovery) is testable
 * without real timers.
 */
import { vi } from "vitest";
import { OrchestratorService } from "../../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../../src/domain/runState.js";
import type { Run, Artifact, RunEventRecord, SkillDocument } from "../../../src/domain/types.js";
import type { Plan } from "../../../src/schemas/plan.js";
import type { PlanReview } from "../../../src/schemas/planReview.js";
import type { PlanRevision } from "../../../src/schemas/planRevision.js";
import type { ExecutionReport } from "../../../src/schemas/executionReport.js";
import type { Review } from "../../../src/schemas/review.js";
import type { Remediation } from "../../../src/schemas/remediation.js";
import type { TaskBundle } from "../../../src/schemas/taskBundle.js";
import type { LinearIssue } from "../../../src/linear/linearClient.js";

export const BASE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Issue description",
    linearIssueTitle: "Issue title",
    linearIssueUrl: "https://linear.app/x/ENG-1",
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
    createdAt: new Date(BASE_TIME),
    updatedAt: new Date(BASE_TIME),
    ...overrides,
  };
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Implement the feature",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [
      { id: "s1", title: "Add module", description: "Create src/feature.ts" },
      { id: "s2", title: "Add tests", description: "Cover the module" },
    ],
    testPlan: "Run unit tests",
    confidence: 0.85,
    ...overrides,
  };
}

export function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Plan looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/feature.ts"],
    checks: {
      lint: { status: "pass", details: "lint ok" },
      typecheck: { status: "pass", details: "tsc ok" },
      tests: { status: "pass", details: "12 passed" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid implementation",
    ...overrides,
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Code looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "LIN-1",
    identifier: "ENG-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "eng-1-issue-title",
    state: "Todo",
    labels: ["feature"],
    priority: 2,
    url: "https://linear.app/x/ENG-1",
    project: "Proj",
    team: "ENG",
    cycle: "Cycle 1",
    ...overrides,
  };
}

export function makeRepoEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-repo",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: ["infra/"],
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

export function makeSkill(id: string): SkillDocument {
  return {
    id,
    repoSlug: "test-repo",
    name: `skill ${id}`,
    description: null,
    taskCategory: "feature",
    skillMarkdown: "# skill",
    utilityScore: 0.5,
    lastUsedAt: new Date(BASE_TIME),
  };
}

export interface HarnessConfig {
  /** Outputs returned (and persisted) by successive plannerAgent.run calls; the last one is sticky. */
  plannerOutputs: Partial<Plan>[];
  /** Outputs returned (and persisted) by successive planReviewerAgent.run calls; the last one is sticky. */
  planReviews: PlanReview[];
  dispositions: PlanRevision["dispositions"];
  executionReport: ExecutionReport;
  prNumber: number;
  /** Outputs of successive reviewerAgent.run calls; the last one is sticky. */
  reviews: Review[];
  remediationReport: Partial<ExecutionReport>;
}

export interface HarnessOptions {
  run?: Run | null;
  artifacts?: { type: string; version: number; payloadJson: unknown }[];
  events?: { eventType: string; payloadJson?: unknown }[];
  withSkillRepo?: boolean;
  skills?: SkillDocument[];
  withDistillation?: boolean;
  withResearcher?: boolean;
  withDashboard?: boolean;
  config?: Partial<HarnessConfig>;
}

export function createHarness(opts: HarnessOptions = {}) {
  let tick = 0;
  const now = (): Date => new Date(BASE_TIME + ++tick * 1000);

  const store: {
    run: Run | null;
    artifacts: Artifact[];
    events: RunEventRecord[];
  } = {
    run: opts.run === undefined ? makeRun() : opts.run,
    artifacts: [],
    events: [],
  };

  const config: HarnessConfig = {
    plannerOutputs: [{}],
    planReviews: [makePlanReview()],
    dispositions: [],
    executionReport: makeExecutionReport(),
    prNumber: 42,
    reviews: [makeReview()],
    remediationReport: {},
    ...opts.config,
  };

  const pushArtifact = (type: string, version: number, payloadJson: unknown): Artifact => {
    const a: Artifact = {
      id: `artifact-${type}-${version}-${store.artifacts.length}`,
      runId: store.run?.id ?? "run-1",
      type: type as Artifact["type"],
      version,
      payloadJson,
      rawText: JSON.stringify(payloadJson),
      createdAt: now(),
    };
    store.artifacts.push(a);
    return a;
  };

  const pushEvent = (eventType: string, source: string, payloadJson: unknown): RunEventRecord => {
    const e: RunEventRecord = {
      id: `event-${store.events.length + 1}`,
      runId: store.run?.id ?? "run-1",
      eventType,
      source,
      payloadJson: payloadJson ?? null,
      createdAt: now(),
    };
    store.events.push(e);
    return e;
  };

  for (const e of opts.events ?? []) pushEvent(e.eventType, "seed", e.payloadJson ?? {});
  for (const a of opts.artifacts ?? []) pushArtifact(a.type, a.version, a.payloadJson);

  const currentRun = (): Run => {
    if (!store.run) throw new Error("harness: no run in store");
    return { ...store.run };
  };

  const runRepo = {
    findById: vi.fn(async (id: string) => (store.run && store.run.id === id ? currentRun() : null)),
    findActiveByIssueId: vi.fn(async (_issueId: string): Promise<Run | null> => null),
    findAll: vi.fn(),
    findByIssueId: vi.fn(),
    create: vi.fn(async (params: Partial<Run>) => {
      store.run = makeRun({
        id: "run-1",
        state: RunState.Todo,
        branchName: null,
        prNumber: null,
        planVersion: 0,
        ...params,
      });
      return currentRun();
    }),
    update: vi.fn(async (_id: string, patch: Partial<Run>) => {
      store.run = { ...currentRun(), ...patch };
      return currentRun();
    }),
    updateState: vi.fn(async (_id: string, state: RunState) => {
      store.run = { ...currentRun(), state };
      return currentRun();
    }),
  };

  const artifactRepo = {
    create: vi.fn(
      async (p: { runId: string; type: string; version: number; payloadJson: unknown }) =>
        pushArtifact(p.type, p.version, p.payloadJson),
    ),
    findByRunId: vi.fn(async () => [...store.artifacts]),
    findLatestByType: vi.fn(async (_runId: string, type: string) => {
      let best: Artifact | null = null;
      for (const a of store.artifacts) {
        if (a.type !== type) continue;
        if (!best || a.version >= best.version) best = a;
      }
      return best;
    }),
  };

  const eventRepo = {
    create: vi.fn(
      async (p: { runId: string; eventType: string; source: string; payloadJson?: unknown }) =>
        pushEvent(p.eventType, p.source, p.payloadJson),
    ),
    findByRunId: vi.fn(async () => [...store.events]),
  };

  const linearClient = {
    getIssue: vi.fn(async (_id: string) => makeIssue()),
    getRelatedContext: vi.fn(async () => ({ blockers: [] })),
    postComment: vi.fn(async (_issueId: string, _body: string) => undefined),
  };

  const githubClient = {
    getDefaultBranch: vi.fn(async (_repo: string) => "main"),
    getPRDiff: vi.fn(async (_repo: string, _pr: number) => "diff --git a/src/feature.ts"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn((_project?: string, _team?: string) => makeRepoEntry()),
    resolveWorkingDirectory: vi.fn((_entry: unknown) => "/repos/test-repo"),
    validateWorkingDirectory: vi.fn((_dir: string) => undefined),
    getRepoByName: vi.fn((_name: string) => makeRepoEntry() as ReturnType<typeof makeRepoEntry> | undefined),
    getDefaultRepo: vi.fn(() => makeRepoEntry({ name: "default-repo" })),
  };

  const gitService = {
    setupRunWorktree: vi.fn(async (_dir: string, runId: string) => ({
      worktreePath: `/repos/test-repo/.worktrees/${runId}`,
      branchName: `ai/${runId}`,
    })),
    assertBranch: vi.fn(async () => undefined),
    commitAndPush: vi.fn(async () => undefined),
    removeWorktree: vi.fn(async () => undefined),
    resolveMainRepoPath: vi.fn((_dir: string) => "/repos/test-repo"),
  };

  const linearSync = { syncState: vi.fn(async (_run: Run) => undefined) };
  const githubSync = {
    syncState: vi.fn(async (_run: Run) => undefined),
    postReviewFindings: vi.fn(async () => new Map<string, number>()),
    postExecutionReportUpdate: vi.fn(async () => undefined),
    postRemediationResolutions: vi.fn(async () => undefined),
  };

  const sticky = <T>(queue: T[]): T => (queue.length > 1 ? (queue.shift() as T) : (queue[0] as T));

  const plannerAgent = {
    run: vi.fn(async (_bundle: TaskBundle, _runId: string, o?: { planVersionOverride?: number }) => {
      const plan = makePlan({
        ...sticky(config.plannerOutputs),
        planVersion: o?.planVersionOverride ?? 1,
      });
      pushArtifact("Plan", plan.planVersion, plan);
      return plan;
    }),
  };

  const planReviewerAgent = {
    run: vi.fn(async (_plan: Plan, _bundle: TaskBundle, _runId: string, _o?: unknown) => {
      const review = sticky(config.planReviews);
      pushArtifact("PlanReview", 1, review);
      return review;
    }),
  };

  const planReviserAgent = {
    run: vi.fn(
      async (plan: Plan, review: PlanReview, _b: TaskBundle, _runId: string, _o?: unknown) => {
        const revisedPlan = makePlan({
          ...plan,
          planVersion: plan.planVersion + 1,
          summary: `${plan.summary} (revised)`,
        });
        const revision: PlanRevision = {
          originalPlanVersion: plan.planVersion,
          revisedPlanVersion: revisedPlan.planVersion,
          reviewId: review.reviewId,
          dispositions: config.dispositions,
        };
        pushArtifact("PlanRevision", revisedPlan.planVersion, revision);
        pushArtifact("Plan", revisedPlan.planVersion, revisedPlan);
        return { revision, revisedPlan };
      },
    ),
  };

  const executorAgent = {
    run: vi.fn(
      async (_plan: Plan, _b: TaskBundle, _runId: string, _retry?: unknown, _o?: unknown) => {
        const report = config.executionReport;
        pushArtifact("ExecutionReport", report.executionVersion, report);
        return { report, prNumber: config.prNumber };
      },
    ),
  };

  const reviewerAgent = {
    run: vi.fn(async (..._args: unknown[]) => {
      const review = sticky(config.reviews);
      pushArtifact("Review", 1, review);
      return review;
    }),
  };

  const remediationAgent = {
    run: vi.fn(async (review: Review, prev: ExecutionReport, _wd: string, _runId: string) => {
      const executionReport = makeExecutionReport({
        executionVersion: prev.executionVersion + 1,
        summary: "Addressed review findings",
        score: 0.9,
        scoreRationale: "Findings fixed",
        ...config.remediationReport,
      });
      const remediation: Remediation = {
        reviewId: review.reviewId,
        resolution: review.findings.map((f) => ({
          findingId: f.id,
          status: "accepted" as const,
          action: `Fixed ${f.title}`,
          rationale: "Valid finding",
        })),
        readyForHumanReview: true,
        executionReport,
      };
      pushArtifact("ExecutionReport", executionReport.executionVersion, executionReport);
      pushArtifact("Remediation", 1, remediation);
      return remediation;
    }),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn(async () => opts.skills ?? []),
    incrementSuccess: vi.fn(async (id: string) => ({ id, outcome: "success" })),
    incrementFailure: vi.fn(async (id: string) => ({ id, outcome: "failure" })),
    archiveIfLowUtility: vi.fn(async () => undefined),
  };

  const distillationAgent = { run: vi.fn(async (_runId: string, _run: Run) => undefined) };

  const answerResearcherAgent = {
    run: vi.fn(async (plan: Plan, _b: TaskBundle, _runId: string, _o?: unknown) => {
      const researched = {
        summary: "Researched open questions",
        answers: plan.openQuestions.map((q, i) => ({
          questionId: q.id,
          question: q.question,
          answer: `answer ${q.id}`,
          confidence: i === 0 ? ("high" as const) : ("unresolved" as const),
        })),
        completedAt: new Date(BASE_TIME).toISOString(),
      };
      pushArtifact("ResearchedAnswers", 1, researched);
      return researched;
    }),
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
    ...(opts.withDashboard === false ? {} : { dashboardEmitter }),
    ...(opts.withSkillRepo ? { agentSkillRepo } : {}),
    ...(opts.withDistillation ? { distillationAgent } : {}),
    ...(opts.withResearcher ? { answerResearcherAgent } : {}),
  };

  const svc = new OrchestratorService(deps as never);

  return {
    svc,
    store,
    config,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    repoRegistry,
    gitService,
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
    /** Event types recorded via eventRepo.create during the test (seeded events excluded). */
    recordedEventTypes: (): string[] =>
      eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType),
    recordedEvent: (eventType: string) =>
      eventRepo.create.mock.calls
        .map((c) => c[0] as { eventType: string; source: string; payloadJson?: unknown })
        .find((e) => e.eventType === eventType),
    comments: (): string[] => linearClient.postComment.mock.calls.map((c) => c[1]),
    artifactsOfType: (type: string) => store.artifacts.filter((a) => a.type === type),
    /** Insert an event at the current clock tick (used to build recovery timelines). */
    addEvent: (eventType: string) => pushEvent(eventType, "seed", {}),
    addArtifact: (type: string, version: number, payloadJson: unknown) =>
      pushArtifact(type, version, payloadJson),
  };
}

export type Harness = ReturnType<typeof createHarness>;
