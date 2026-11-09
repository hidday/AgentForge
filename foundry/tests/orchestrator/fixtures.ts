// Shared, non-test fixture/mock builders for orchestratorService.*.test.ts files.
// This file matches no `*.test.ts` glob so vitest never collects it as a suite.
// It intentionally mirrors the inline helper style used by the existing
// orchestratorService test files (makeRun/makePlan/buildDeps) to avoid
// re-deriving fixture shapes in every new test file.
import { vi } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, ArtifactType } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { Remediation } from "../../src/schemas/remediation.js";

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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

export function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Initial implementation.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good.",
    ...overrides,
  };
}

export function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "plan-rev-1",
    summary: "Plan looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

export function makeRemediation(
  executionReport: ExecutionReport,
  overrides: Partial<Remediation> = {},
): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Was broken" },
    ],
    readyForHumanReview: true,
    executionReport,
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
    createdAt: new Date(),
    ...overrides,
  };
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
    emitQuestionsAnswered: vi.fn(),
  };
}

export function makeDefaultRepoEntry(overrides: Record<string, unknown> = {}) {
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

export function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "LIN-1",
    title: "Test issue",
    description: "Test description",
    branchName: "hidday/lin-1-test-issue",
    labels: [] as string[],
    priority: 0,
    project: "test-project",
    cycle: undefined,
    ...overrides,
  };
}

/**
 * Plain, individually-mocked-method deps bag (vi.fn() per method), matching
 * the style of the existing orchestratorService test files. Good for tests
 * that want to script exact call sequences with mockResolvedValueOnce.
 */
export function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
    findRunsNeedingLinearBackfill: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn(),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi
      .fn()
      .mockResolvedValue({ parent: undefined, blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(makeDefaultRepoEntry()),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(makeDefaultRepoEntry()),
    getDefaultRepo: vi.fn().mockReturnValue(makeDefaultRepoEntry()),
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
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test1234" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

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

/**
 * Wire a mocked plannerAgent.run to behave like the real PlannerAgent: it
 * persists the Plan artifact it returns (planReviserAgent and others do the
 * same for their own artifact types below). `planFactory` receives the
 * PlannerRunOptions passed to `run` so tests can vary output based on
 * planVersionOverride, humanAnswers, etc.
 */
export function wirePlannerAgent(
  artifactRepo: ReturnType<typeof buildStoreDeps>["artifactRepo"],
  plannerAgent: ReturnType<typeof buildStoreDeps>["plannerAgent"],
  planFactory: (opts: Record<string, unknown> | undefined) => Plan,
): void {
  plannerAgent.run.mockImplementation(
    async (_bundle: unknown, runId: string, opts?: Record<string, unknown>) => {
      const plan = planFactory(opts);
      await artifactRepo.create({
        runId,
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: JSON.stringify(plan),
      });
      return plan;
    },
  );
}

export function wirePlanReviewerAgent(
  artifactRepo: ReturnType<typeof buildStoreDeps>["artifactRepo"],
  planReviewerAgent: ReturnType<typeof buildStoreDeps>["planReviewerAgent"],
  planReviewFactory: () => PlanReview,
): void {
  planReviewerAgent.run.mockImplementation(async (_plan: unknown, _bundle: unknown, runId: string) => {
    const planReview = planReviewFactory();
    await artifactRepo.create({
      runId,
      type: "PlanReview",
      version: 1,
      payloadJson: planReview,
      rawText: JSON.stringify(planReview),
    });
    return planReview;
  });
}

export function wirePlanReviserAgent(
  artifactRepo: ReturnType<typeof buildStoreDeps>["artifactRepo"],
  planReviserAgent: ReturnType<typeof buildStoreDeps>["planReviserAgent"],
  revisedPlanFactory: (plan: Plan) => Plan,
): void {
  planReviserAgent.run.mockImplementation(async (plan: Plan, _planReview: unknown, _bundle: unknown, runId: string) => {
    const revisedPlan = revisedPlanFactory(plan);
    const revision = {
      dispositions: [{ findingId: "f1", status: "addressed", rationale: "Fixed" }],
      revisedPlan,
    };
    await artifactRepo.create({
      runId,
      type: "PlanRevision",
      version: revisedPlan.planVersion,
      payloadJson: revision,
      rawText: JSON.stringify(revision),
    });
    await artifactRepo.create({
      runId,
      type: "Plan",
      version: revisedPlan.planVersion,
      payloadJson: revisedPlan,
      rawText: JSON.stringify(revisedPlan),
    });
    return { revision, revisedPlan };
  });
}

export function wireExecutorAgent(
  artifactRepo: ReturnType<typeof buildStoreDeps>["artifactRepo"],
  executorAgent: ReturnType<typeof buildStoreDeps>["executorAgent"],
  reportFactory: () => ExecutionReport,
  prNumber = 7,
): void {
  executorAgent.run.mockImplementation(async (_plan: unknown, _bundle: unknown, runId: string) => {
    const report = reportFactory();
    await artifactRepo.create({
      runId,
      type: "ExecutionReport",
      version: report.executionVersion,
      payloadJson: report,
      rawText: JSON.stringify(report),
    });
    return { report, prNumber };
  });
}

export function wireReviewerAgent(
  artifactRepo: ReturnType<typeof buildStoreDeps>["artifactRepo"],
  reviewerAgent: ReturnType<typeof buildStoreDeps>["reviewerAgent"],
  reviewFactory: () => Review,
): void {
  reviewerAgent.run.mockImplementation(
    async (_plan: unknown, _report: unknown, _diff: unknown, _bundle: unknown, runId: string) => {
      const review = reviewFactory();
      await artifactRepo.create({
        runId,
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review),
      });
      return review;
    },
  );
}

export function wireRemediationAgent(
  artifactRepo: ReturnType<typeof buildStoreDeps>["artifactRepo"],
  remediationAgent: ReturnType<typeof buildStoreDeps>["remediationAgent"],
  newReportFactory: (prevReport: ExecutionReport) => ExecutionReport,
): void {
  remediationAgent.run.mockImplementation(
    async (review: Review, executionReport: ExecutionReport, _workingDirectory: string, runId: string) => {
      const newReport = newReportFactory(executionReport);
      const remediation = makeRemediation(newReport, { reviewId: review.reviewId });
      await artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: newReport.executionVersion,
        payloadJson: newReport,
        rawText: JSON.stringify(newReport),
      });
      await artifactRepo.create({
        runId,
        type: "Remediation",
        version: 1,
        payloadJson: remediation,
        rawText: JSON.stringify(remediation),
      });
      return remediation;
    },
  );
}

export interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: { id: string; runId: string; eventType: string; source: string; payloadJson?: unknown; createdAt: Date }[];
}

/**
 * A stateful fake backing store shared by runRepo/artifactRepo/eventRepo, so
 * multi-stage flows (e.g. runExecution -> runReview -> runRemediation ->
 * markReady) behave like the real repositories: state transitions persist,
 * and findLatestByType reflects whatever the orchestrator (or an agent mock)
 * most recently wrote. Mirrors the pattern used in
 * orchestratorService.executionScore.test.ts.
 */
export function buildStoreDeps(initialRun: Run, initialArtifacts: Artifact[] = []) {
  const store: TestStore = {
    run: { ...initialRun },
    artifacts: [...initialArtifacts],
    events: [],
  };

  let eventCounter = 0;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
    findRunsNeedingLinearBackfill: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; type: ArtifactType; version: number; payloadJson: unknown; rawText: string }) => {
        const a = makeArtifact({
          type: params.type,
          version: params.version,
          payloadJson: params.payloadJson,
          rawText: params.rawText,
          runId: params.runId,
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      eventCounter += 1;
      const evt = {
        id: `event-${eventCounter}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson,
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue(makeIssue()),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: undefined, blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(makeDefaultRepoEntry()),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(makeDefaultRepoEntry()),
    getDefaultRepo: vi.fn().mockReturnValue(makeDefaultRepoEntry()),
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
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test1234" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = makeLogger();
  const dashboardEmitter = makeDashboardEmitter();

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
    deps,
    store,
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
