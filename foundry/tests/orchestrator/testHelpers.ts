import { vi } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { transition } from "../../src/orchestrator/stateMachine.js";
import type { Run, Artifact, ArtifactType } from "../../src/domain/types.js";
import type { RunEvent } from "../../src/domain/runEvent.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

/**
 * Shared test fixtures for OrchestratorService tests. Not itself a *.test.ts
 * file, so vitest's `include: ["tests/**\/*.test.ts"]` never collects it.
 */

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "A test issue",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/issue/LIN-1",
    repo: "test-repo",
    branchName: "ai/lin-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
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

export function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Executed the plan",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid implementation",
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
      repoPath: "/tmp/repo",
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export interface DepsOptions {
  /** Initial run row (mutated by the fake runRepo as transitions happen). */
  run?: Run;
  /** Seed artifacts by type; findLatestByType returns the last-set value for that type. */
  artifacts?: Partial<Record<ArtifactType, Artifact | null>>;
  /** Include the optional agentSkillRepo dependency. */
  withAgentSkillRepo?: boolean;
  /** Include the optional distillationAgent dependency. */
  withDistillationAgent?: boolean;
  /** Include the optional answerResearcherAgent dependency. */
  withAnswerResearcherAgent?: boolean;
  /** Extra deps overrides merged in last (wins over generated defaults). */
  overrides?: Record<string, unknown>;
}

/**
 * Builds a full OrchestratorDeps mock set with stateful runRepo (findById /
 * update / updateState reflect real mutations, and updateState computes the
 * next state via the real stateMachine.transition so tests don't need to
 * hand-chain mockResolvedValueOnce sequences), plus sensible defaults for
 * every other dependency. Individual tests override specific methods via
 * `deps.someRepo.someMethod.mockResolvedValueOnce(...)` etc. after creation,
 * or via `overrides`.
 */
export function buildDeps(opts: DepsOptions = {}) {
  let currentRun = { ...(opts.run ?? makeRun()) };
  const artifactsByType = new Map<string, Artifact | null>(
    Object.entries(opts.artifacts ?? {}) as [string, Artifact | null][],
  );

  const runRepo = {
    findById: vi.fn().mockImplementation(async () => ({ ...currentRun })),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(async (data: Partial<Run>) => {
      currentRun = { ...currentRun, ...data };
      return { ...currentRun };
    }),
    findByIssueId: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockImplementation(async (_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return { ...currentRun };
    }),
    updateState: vi.fn().mockImplementation(async (_id: string, newState: RunState) => {
      currentRun = { ...currentRun, state: newState };
      return { ...currentRun };
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation(async (data: { type: ArtifactType }) => {
      artifactsByType.set(
        data.type,
        makeArtifact({ ...(data as Partial<Artifact>), type: data.type }),
      );
      return { id: `artifact-${data.type}` };
    }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockImplementation(async (_runId: string, type: ArtifactType) => {
      return artifactsByType.has(type) ? artifactsByType.get(type) : null;
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
      team: "test-team",
      identifier: "LIN-1",
      url: "https://linear.app/issue/LIN-1",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: undefined, blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/src/a.ts b/src/a.ts"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const defaultRepoEntry = {
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
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
  };

  // The real PlannerAgent persists a "Plan" artifact as a side effect of run().
  // Mirror that here so callers (runPlanReview, approvePlan, etc.) that read
  // the Plan artifact back via artifactRepo.findLatestByType see it, without
  // every test having to seed the artifact by hand. A queue supports flows
  // that call the planner more than once (e.g. answer-researcher re-plans)
  // with different plan versions; once drained, the last plan sticks.
  let plannerPlanQueue: Plan[] = [makePlan()];
  const plannerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const plan = plannerPlanQueue.length > 1 ? plannerPlanQueue.shift()! : plannerPlanQueue[0];
      artifactsByType.set(
        "Plan",
        makeArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }),
      );
      return plan;
    }),
  };
  // The remaining agents likewise persist their own output artifact as a side
  // effect of run() in production. Mirror that via mutable result variables +
  // setters so that a later call in the same flow (e.g. runReview calling
  // runRemediation, which reads back the "Review" artifact) sees consistent
  // data without every test manually seeding artifacts.
  let planReviewResult: {
    reviewId: string;
    overallVerdict: "approved" | "changes_requested";
    summary: string;
    findings: unknown[];
  } = { reviewId: "planreview-1", overallVerdict: "approved", summary: "Looks good", findings: [] };
  const planReviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      artifactsByType.set(
        "PlanReview",
        makeArtifact({ type: "PlanReview", payloadJson: planReviewResult }),
      );
      return planReviewResult;
    }),
  };

  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };

  let executorResult: { report: ExecutionReport; prNumber: number } = {
    report: makeExecutionReport(),
    prNumber: 42,
  };
  const executorAgent = {
    run: vi.fn().mockImplementation(async () => {
      artifactsByType.set(
        "ExecutionReport",
        makeArtifact({
          type: "ExecutionReport",
          version: executorResult.report.executionVersion,
          payloadJson: executorResult.report,
        }),
      );
      return executorResult;
    }),
  };

  let reviewResult: Review = makeReview();
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      artifactsByType.set("Review", makeArtifact({ type: "Review", payloadJson: reviewResult }));
      return reviewResult;
    }),
  };

  let remediationResult: {
    executionReport: ExecutionReport;
    resolution: { findingId: string; status: string; action: string; rationale: string }[];
  } = { executionReport: makeExecutionReport({ executionVersion: 2 }), resolution: [] };
  const remediationAgent = {
    run: vi.fn().mockImplementation(async () => {
      artifactsByType.set(
        "ExecutionReport",
        makeArtifact({
          type: "ExecutionReport",
          version: remediationResult.executionReport.executionVersion,
          payloadJson: remediationResult.executionReport,
        }),
      );
      artifactsByType.set(
        "Remediation",
        makeArtifact({ type: "Remediation", payloadJson: remediationResult }),
      );
      return remediationResult;
    }),
  };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/repo/worktrees/run-1", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/repo"),
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
    emitProcessStarted: vi.fn(),
    emitProcessOutput: vi.fn(),
    emitProcessCompleted: vi.fn(),
    emitChatReply: vi.fn(),
  };

  const agentSkillRepo = opts.withAgentSkillRepo
    ? {
        findTopKByRelevance: vi.fn().mockResolvedValue([]),
        incrementSuccess: vi.fn().mockImplementation(async (id: string) => ({ id })),
        incrementFailure: vi.fn().mockImplementation(async (id: string) => ({ id })),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
      }
    : undefined;

  const distillationAgent = opts.withDistillationAgent
    ? { run: vi.fn().mockResolvedValue(undefined) }
    : undefined;

  let researchedAnswersResult = {
    summary: "Researched",
    answers: [] as { questionId: string; question: string; answer: string; confidence: string }[],
    completedAt: new Date().toISOString(),
  };
  const answerResearcherAgent = opts.withAnswerResearcherAgent
    ? {
        run: vi.fn().mockImplementation(async () => {
          artifactsByType.set(
            "ResearchedAnswers",
            makeArtifact({ type: "ResearchedAnswers", payloadJson: researchedAnswersResult }),
          );
          return researchedAnswersResult;
        }),
      }
    : undefined;

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
    ...(agentSkillRepo ? { agentSkillRepo } : {}),
    ...(distillationAgent ? { distillationAgent } : {}),
    ...(answerResearcherAgent ? { answerResearcherAgent } : {}),
    ...(opts.overrides ?? {}),
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
    agentSkillRepo,
    distillationAgent,
    answerResearcherAgent,
    getCurrentRun: () => ({ ...currentRun }),
    setCurrentRun: (r: Run) => {
      currentRun = { ...r };
    },
    /** Queue additional plans for successive plannerAgent.run() calls (FIFO; last one sticks). */
    queuePlannerPlans: (...plans: Plan[]) => {
      plannerPlanQueue.push(...plans);
    },
    /** Replace the plan every future plannerAgent.run() call returns (and persists as the Plan artifact). */
    setPlannerPlan: (plan: Plan) => {
      plannerPlanQueue = [plan];
    },
    setPlanReviewResult: (result: typeof planReviewResult) => {
      planReviewResult = result;
    },
    setExecutorResult: (result: typeof executorResult) => {
      executorResult = result;
    },
    setReviewResult: (result: Review) => {
      reviewResult = result;
    },
    setRemediationResult: (result: typeof remediationResult) => {
      remediationResult = result;
    },
    setResearchedAnswersResult: (result: typeof researchedAnswersResult) => {
      researchedAnswersResult = result;
    },
    /** Directly seed / clear an artifact of the given type (bypasses the agent mocks). */
    setArtifact: (type: ArtifactType, artifact: Artifact | null) => {
      artifactsByType.set(type, artifact);
    },
  };
}

/** Compute the state reached from `from` after applying `event`, using the real state machine. */
export function nextState(from: RunState, event: RunEvent): RunState {
  return transition(from, event);
}
