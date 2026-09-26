import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
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
    create: vi.fn().mockImplementation((params: { runId: string; type: string; version: number; payloadJson: unknown }) => {
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
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
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "default-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };

  const plannerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const plan = makePlan();
      await artifactRepo.create({ runId: store.run.id, type: "Plan", version: plan.planVersion, payloadJson: plan });
      return plan;
    }),
  };
  const planReviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = { reviewId: "prv-1", summary: "ok", findings: [], overallVerdict: "approved" as const };
      await artifactRepo.create({ runId: store.run.id, type: "PlanReview", version: 1, payloadJson: review });
      return review;
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
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
    repoRegistry,
    gitService,
    planReviewerAgent,
  };
}

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree and persists workingDirectory/branchName when the run has no branchName yet", async () => {
    const store: TestStore = { run: makeRun({ branchName: null, workingDirectory: "/tmp" }), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.retryRun("run-1");

    expect(built.gitService.resolveMainRepoPath).toHaveBeenCalledWith("/tmp");
    expect(built.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(built.runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ workingDirectory: "/tmp/worktree", branchName: "ai/run-1" }),
    );
  });

  it("skips worktree setup entirely when the run already has a branchName", async () => {
    const store: TestStore = { run: makeRun({ branchName: "ai/existing" }), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("falls back to repoRegistry.getDefaultRepo() when getRepoByName returns null", async () => {
    const store: TestStore = { run: makeRun({ branchName: null }), artifacts: [], events: [] };
    const built = buildDeps(store);
    built.repoRegistry.getRepoByName.mockReturnValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.retryRun("run-1");

    expect(built.repoRegistry.getDefaultRepo).toHaveBeenCalled();
    expect(built.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "run-1",
      "main",
      "ai/lin-1",
    );
  });

  it("proceeds through planning and plan review to AwaitingPlanApproval on the happy path", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.retryRun("run-1");

    expect(built.planReviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for clarification when the fresh plan has blocking open questions", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    built.deps.plannerAgent.run = vi.fn().mockImplementation(async () => {
      const plan = makePlan({
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      });
      await built.deps.artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
      });
      return plan;
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
