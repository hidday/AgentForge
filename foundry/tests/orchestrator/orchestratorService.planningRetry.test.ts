import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
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

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
}): Artifact {
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
}

/**
 * Real planner agents persist the resulting Plan artifact themselves; since the
 * planner is mocked here, this makes the mock do the same so that downstream
 * calls (runPlanReview reading the latest "Plan" artifact) see the new version.
 */
function mockPlannerReturning(
  plannerAgent: { run: ReturnType<typeof vi.fn> },
  store: TestStore,
  plan: Plan,
): void {
  plannerAgent.run.mockImplementation(async () => {
    store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
    return plan;
  });
}

function buildDeps(store: TestStore, initialRun: Run) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation(() => Promise.resolve({ ...initialRun, state: store.runState })),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
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
    getRepoByName: vi.fn().mockReturnValue(null),
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
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1-retry" }),
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
    planReviewerAgent,
    gitService,
    linearClient,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans using prior context artifacts and proceeds to plan review when there are no blockers", async () => {
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [
        asArtifact({
          type: "RejectionContext",
          version: 1,
          payloadJson: { planVersion: 1, feedback: "please redo this", source: "api", mode: "iterate" },
        }),
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
        asArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q2", answer: "researched", confidence: "high" }] },
        }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: {
            summary: "needs fixes",
            findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
          },
        }),
      ],
    };

    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    mockPlannerReturning(plannerAgent, store, newPlan);

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanFeedback: { planVersion: 1, feedback: "please redo this" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", answer: "researched", confidence: "high" }],
        planReviewFindings: {
          summary: "needs fixes",
          findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
        },
      }),
    );

    // Auto-approved plan review carries the run all the way to AwaitingPlanApproval.
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification instead of running plan review when blocking questions remain", async () => {
    const store: TestStore = { runState: RunState.Planning, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    mockPlannerReturning(
      plannerAgent,
      store,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName, then proceeds to plan review", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, planVersion: 0, branchName: null });
    const { deps, plannerAgent, gitService } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    mockPlannerReturning(plannerAgent, store, makePlan({ planVersion: 1, openQuestions: [] }));

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, planVersion: 0, branchName: "ai/run-1" });
    const { deps, plannerAgent, gitService } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    mockPlannerReturning(plannerAgent, store, makePlan({ planVersion: 1, openQuestions: [] }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo, planVersion: 0, branchName: "ai/run-1" });
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    mockPlannerReturning(
      plannerAgent,
      store,
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
