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
    state: RunState.Planning,
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
    planVersion: 2,
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

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
}

function asArtifact(params: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${params.type}-${params.version}`,
    runId: "run-1",
    type: params.type as Artifact["type"],
    version: params.version,
    payloadJson: params.payloadJson,
    rawText: JSON.stringify(params.payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(store: TestStore, initialRun: Run) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ ...initialRun, id, state: store.runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, params: Record<string, unknown>) =>
      Promise.resolve({ ...initialRun, ...params, state: store.runState }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact(params);
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
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
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoEntry = {
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
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = {
    run: vi
      .fn()
      .mockImplementation(
        async (
          _bundle: unknown,
          _runId: string,
          opts?: { planVersionOverride?: number; openQuestions?: Plan["openQuestions"] },
        ) => {
          const plan = makePlan({
            ...(opts?.planVersionOverride ? { planVersion: opts.planVersionOverride } : {}),
          });
          await artifactRepo.create({
            runId: "run-1",
            type: "Plan",
            version: plan.planVersion,
            payloadJson: plan,
            rawText: JSON.stringify(plan),
          });
          return plan;
        },
      ),
  };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "rev-1",
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
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test1234" }),
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
    linearClient,
    plannerAgent,
    planReviewerAgent,
    gitService,
    repoRegistry,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans injecting rejectionContext, previousPlan, humanAnswers, researchedAnswers, and planReviewFindings when present, then proceeds to plan review", async () => {
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({
          type: "RejectionContext",
          version: 1,
          payloadJson: { planVersion: 1, feedback: "be more specific", source: "api", mode: "iterate" },
        }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
        asArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: {
            summary: "research",
            completedAt: new Date().toISOString(),
            answers: [{ questionId: "q1", question: "?", answer: "yes", confidence: "high" }],
          },
        }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "needs work", findings: [] },
        }),
      ],
    };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanFeedback: { planVersion: 1, feedback: "be more specific" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          { questionId: "q1", question: "?", answer: "yes", confidence: "high" },
        ],
        planReviewFindings: { summary: "needs work", findings: [] },
      }),
    );

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("calls plannerAgent.run without optional context fields when no prior artifacts exist", async () => {
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
    };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ humanFeedback: expect.anything() }),
    );
    const callArgs = built.plannerAgent.run.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callArgs.humanAnswers).toBeUndefined();
    expect(callArgs.researchedAnswers).toBeUndefined();
    expect(callArgs.planReviewFindings).toBeUndefined();
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
    };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const built = buildDeps(store, initialRun);
    built.plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      });
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "{}",
      });
      return plan;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: null });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("falls back to getDefaultRepo when getRepoByName returns nothing", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: null });
    const built = buildDeps(store, initialRun);
    built.repoRegistry.getRepoByName.mockReturnValue(undefined);

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(built.repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the fresh plan has blocking questions", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const built = buildDeps(store, initialRun);
    built.plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      });
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "{}",
      });
      return plan;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });
});
