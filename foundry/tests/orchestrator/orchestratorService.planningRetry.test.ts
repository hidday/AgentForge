import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
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

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
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

interface TestStore {
  run: Run;
  artifacts: Artifact[];
}

/** Simulates the real PlannerAgent's side effect of persisting the Plan artifact it returns. */
function persistingPlanRun(store: TestStore, plan: Plan) {
  return vi.fn().mockImplementation(() => {
    store.artifacts.push(makeArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
    return Promise.resolve(plan);
  });
}

function buildDeps(store: TestStore) {
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
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi
      .fn()
      .mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
        const a = makeArtifact({
          type: params.type as Artifact["type"],
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
      }),
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
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
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
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
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
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    }),
  };
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    plannerAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("passes previousPlan, humanFeedback, humanAnswers, researchedAnswers and planReviewFindings when all prior artifacts exist, then reaches PlanReview", async () => {
    const previousPlan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      run: makeRun({ state: RunState.Planning, planVersion: 2 }),
      artifacts: [
        makeArtifact({ type: "Plan", version: 2, payloadJson: previousPlan }),
        makeArtifact({
          type: "RejectionContext",
          version: 2,
          payloadJson: { planVersion: 2, feedback: "fix X", source: "api", mode: "iterate" },
        }),
        makeArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
        makeArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: {
            summary: "s",
            answers: [
              { questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" },
            ],
            completedAt: new Date().toISOString(),
          },
        }),
        makeArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "review summary", findings: [] },
        }),
      ],
    };
    const { deps, plannerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3, openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan,
        humanFeedback: { planVersion: 2, feedback: "fix X" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" }],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
    // No blocking questions in the new plan -> proceeds through PlanReview to AwaitingPlanApproval
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Planning, planVersion: 1 }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const { deps, plannerAgent, logger } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ blockingCount: 1 }),
      "Re-plan has blocking questions, pausing for human clarification",
    );
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName, then reaches PlanReview", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Todo, planVersion: 1, branchName: null }),
      artifacts: [],
    };
    const { deps, plannerAgent, gitService } = buildDeps(store);
    deps.plannerAgent.run = persistingPlanRun(store, makePlan({ planVersion: 1, openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName, and pauses on blocking questions", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Todo, planVersion: 1, branchName: "ai/run-1" }),
      artifacts: [],
    };
    const { deps, plannerAgent, gitService, logger } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ blockingCount: 1 }),
      "Plan has blocking questions, pausing for human clarification",
    );
  });

  it("records RUN_REQUESTED and PLAN_CREATED events along the way", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Todo, planVersion: 1, branchName: "ai/run-1" }),
      artifacts: [],
    };
    const { deps, eventRepo } = buildDeps(store);
    deps.plannerAgent.run = persistingPlanRun(store, makePlan({ planVersion: 1, openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    const eventTypes = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.RUN_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);
  });
});
