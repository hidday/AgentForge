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
    linearIssueTitle: "Fix the auth bug",
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
  } as Run;
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

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown; id?: string }): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}-${Math.random()}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: { id: string; runId: string; eventType: string; source: string; payloadJson: unknown; createdAt: Date }[];
}

function buildDeps(store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(store.run)),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation(() => Promise.resolve(store.run)),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      store.run = { ...store.run, state };
      return Promise.resolve(store.run);
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve(store.run);
    }),
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
    create: vi.fn().mockImplementation((params: { eventType: string; source: string; payloadJson?: unknown }) => {
      const e = { id: `event-${Math.random()}`, runId: "run-1", ...params, payloadJson: params.payloadJson ?? {}, createdAt: new Date() };
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Fix the auth bug",
      description: "auth is broken",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
  const repoEntry = {
    name: "test-repo",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [],
    constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
  };
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] }) };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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

  function setPlannerPlan(plan: Plan) {
    plannerAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
      return Promise.resolve(plan);
    });
  }

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
    logger,
    store,
    setPlannerPlan,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans using prior context, proceeds to plan review, and reaches AwaitingPlanApproval when there are no blockers", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Planning, planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
    const { deps, setPlannerPlan, plannerAgent, planReviewerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    setPlannerPlan(makePlan({ planVersion: 2 }));

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2 }),
    );
    expect(planReviewerAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.run.planVersion).toBe(2);
  });

  it("injects humanFeedback, humanAnswers, researchedAnswers, and planReviewFindings when those artifacts exist", async () => {
    const rejectionContext = { planVersion: 1, feedback: "use OAuth2", source: "api" as const, mode: "iterate" as const };
    const humanAnswers = { answers: [{ questionId: "q1", answer: "yes" }] };
    const researchedAnswers = { summary: "s", answers: [{ questionId: "q2", question: "q", answer: "a", confidence: "high" as const }], completedAt: new Date().toISOString() };
    const planReview = { summary: "needs fixes", findings: [{ id: "f1", severity: "blocker", title: "t", details: "d" }] };

    const store: TestStore = {
      run: makeRun({ state: RunState.Planning, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({ type: "RejectionContext", version: 1, payloadJson: rejectionContext }),
        asArtifact({ type: "HumanAnswers", version: 1, payloadJson: humanAnswers }),
        asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: researchedAnswers }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }),
      ],
      events: [],
    };
    const { deps, setPlannerPlan, plannerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    setPlannerPlan(makePlan({ planVersion: 2 }));

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanFeedback: { planVersion: 1, feedback: "use OAuth2" },
        humanAnswers: humanAnswers.answers,
        researchedAnswers: researchedAnswers.answers,
        planReviewFindings: { summary: "needs fixes", findings: planReview.findings },
      }),
    );
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Planning, planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
    const { deps, setPlannerPlan, planReviewerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    setPlannerPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
      }),
    );

    const result = await svc.runPlanning("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet, then re-plans and reaches plan review", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Todo, branchName: null }), artifacts: [], events: [] };
    const { deps, setPlannerPlan, gitService, planReviewerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    setPlannerPlan(makePlan({ planVersion: 1 }));

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(planReviewerAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Todo, branchName: "ai/run-1" }), artifacts: [], events: [] };
    const { deps, setPlannerPlan, gitService } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    setPlannerPlan(makePlan({ planVersion: 1 }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the re-plan has blocking questions", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Todo, branchName: "ai/run-1" }), artifacts: [], events: [] };
    const { deps, setPlannerPlan, planReviewerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);
    setPlannerPlan(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
      }),
    );

    const result = await svc.retryRun("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
