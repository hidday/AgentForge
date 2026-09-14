import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RejectionContextPayload } from "../../src/domain/types.js";
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

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  runPatch: Partial<Run>;
}

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState }),
      ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.runPatch = { ...store.runPatch, ...patch };
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
    }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
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
    run: vi.fn().mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "OK", findings: [] }),
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

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    gitService,
    repoRegistry,
    logger,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("throws 'Run not found' when the run does not exist", async () => {
    const store: TestStore = { runState: RunState.Planning, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Planning });
    const { deps, runRepo } = buildDeps(store, initialRun);
    runRepo.findById.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("re-plans injecting rejectionContext, previousPlan, humanAnswers, researchedAnswers and planReviewFindings when all are present, then proceeds to plan review", async () => {
    const previousPlan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: previousPlan }),
        asArtifact({
          type: "RejectionContext",
          version: 1,
          payloadJson: { planVersion: 1, feedback: "Use OAuth2", source: "api", mode: "iterate" } as RejectionContextPayload,
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
            summary: "s",
            answers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
            completedAt: "2026-01-01T00:00:00Z",
          },
        }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "review summary", findings: [] },
        }),
      ],
      runPatch: { planVersion: 1 },
    };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, initialRun);

    const nextPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(nextPlan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-2",
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan,
        humanFeedback: { planVersion: 1, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan still has blocking open questions", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: { planVersion: 1 },
    };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, initialRun);

    const blockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Critical?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(blockingPlan);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("throws 'Run not found' when the run does not exist", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo });
    const { deps, runRepo } = buildDeps(store, initialRun);
    runRepo.findById.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.retryRun("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("creates a new worktree via gitService when run.branchName is not set, then proceeds to plan review", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {} };
    const initialRun = makeRun({ state: RunState.Todo, branchName: null });
    const { deps, gitService, repoRegistry, plannerAgent, planReviewerAgent } = buildDeps(store, initialRun);

    plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({ planVersion: 1, openQuestions: [] });
      store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
      return plan;
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(repoRegistry.getRepoByName).toHaveBeenCalledWith("test-repo");
    expect(gitService.resolveMainRepoPath).toHaveBeenCalledWith("/tmp");
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree creation when run.branchName is already set", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {} };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const { deps, gitService, plannerAgent, planReviewerAgent } = buildDeps(store, initialRun);

    plannerAgent.run.mockImplementation(async () => {
      const plan = makePlan({ planVersion: 1, openQuestions: [] });
      store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
      return plan;
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the fresh plan has blocking open questions", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {} };
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, initialRun);

    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
