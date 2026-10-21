import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 0,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "plan-rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
}): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
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
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      Object.assign(initialRun, patch);
      return Promise.resolve({ ...initialRun, state: store.runState });
    }),
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
      identifier: "LIN-1",
      title: "Test issue",
      description: "desc",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
      state: "Todo",
      url: "https://linear.app/x",
      project: "proj",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: null, blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const planReviewVerdict = { current: makePlanReview() };
  const plannerResult = { next: makePlan() };
  // Mirrors the real PlannerAgent, which persists its own Plan artifact.
  const plannerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const plan = plannerResult.next;
      await artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: JSON.stringify(plan),
      });
      return plan;
    }),
  };
  const planReviewerAgent = { run: vi.fn().mockImplementation(() => Promise.resolve(planReviewVerdict.current)) };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree2", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    plannerAgent,
    plannerResult,
    planReviewVerdict,
    gitService,
    linearClient,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans and proceeds to plan review when there are no blocking questions", async () => {
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
    };
    const built = buildDeps(store, makeRun({ state: RunState.Planning, planVersion: 1 }));
    built.plannerResult.next = (makePlan({ planVersion: 2, openQuestions: [] }));
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledTimes(1);
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const store: TestStore = {
      runState: RunState.Planning,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
    };
    const built = buildDeps(store, makeRun({ state: RunState.Planning, planVersion: 1 }));
    built.plannerResult.next = (
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.runPlanning("run-1");

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a fresh worktree when the run has no branchName yet, then proceeds to plan review", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const built = buildDeps(store, makeRun({ state: RunState.Todo, branchName: null, planVersion: 0 }));
    built.plannerResult.next = (makePlan({ planVersion: 1, openQuestions: [] }));
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalledTimes(1);
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const built = buildDeps(
      store,
      makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 0 }),
    );
    built.plannerResult.next = (makePlan({ planVersion: 1, openQuestions: [] }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the retried plan has blocking questions", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const built = buildDeps(
      store,
      makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 0 }),
    );
    built.plannerResult.next = (
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const run = await svc.retryRun("run-1");

    expect(run.state).toBe(RunState.HumanClarificationNeeded);
  });
});
