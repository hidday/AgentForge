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
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
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

function asArtifact(o: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${o.type}-${o.version}-${Math.random().toString(36).slice(2, 7)}`,
    runId: "run-1",
    type: o.type as Artifact["type"],
    version: o.version,
    payloadJson: o.payloadJson,
    rawText: JSON.stringify(o.payloadJson),
    createdAt: new Date(),
  };
}

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation(() => {
      store.run = { ...store.run };
      return Promise.resolve({ ...store.run });
    }),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `evt-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
      project: "proj",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
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
    getDefaultRepo: vi.fn(),
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
      summary: "ok",
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
      .mockResolvedValue({ worktreePath: "/tmp/.worktrees/run-1", branchName: "ai/run-1" }),
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    linearClient,
    githubClient,
    plannerAgent,
    logger,
  };
}

function plannerWritesPlan(
  store: Store,
  plannerAgent: { run: ReturnType<typeof vi.fn> },
) {
  plannerAgent.run.mockImplementation((bundle: unknown) => {
    const p = makePlan({ planVersion: 1, openQuestions: [] });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: p }));
    // Capture the bundle passed in so tests can assert on it.
    (plannerAgent.run as unknown as { lastBundle?: unknown }).lastBundle = bundle;
    return Promise.resolve(p);
  });
}

describe("OrchestratorService -- buildTaskBundle branches (via startRun)", () => {
  it("uses the GitHub remote default branch and logs a warning when it differs from the configured one", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, githubClient, plannerAgent, logger } = buildDeps(store);
    githubClient.getDefaultBranch.mockResolvedValue("trunk");
    plannerWritesPlan(store, plannerAgent);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    const bundle = (plannerAgent.run as unknown as { lastBundle: { repo: { defaultBranch: string } } })
      .lastBundle;
    expect(bundle.repo.defaultBranch).toBe("trunk");
  });

  it("falls back to the configured default branch and logs a warning when getDefaultBranch throws", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, githubClient, plannerAgent, logger } = buildDeps(store);
    githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub unavailable"));
    plannerWritesPlan(store, plannerAgent);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "GitHub unavailable" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    const bundle = (plannerAgent.run as unknown as { lastBundle: { repo: { defaultBranch: string } } })
      .lastBundle;
    expect(bundle.repo.defaultBranch).toBe("main");
  });

  it("stringifies a non-Error rejection from getDefaultBranch when logging the fallback warning", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, githubClient, plannerAgent, logger } = buildDeps(store);
    githubClient.getDefaultBranch.mockRejectedValue("network blip");
    plannerWritesPlan(store, plannerAgent);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "network blip" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("stringifies a non-Error rejection from getRelatedContext when logging the fallback warning", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, linearClient, plannerAgent, logger } = buildDeps(store);
    linearClient.getRelatedContext.mockRejectedValue("linear blip");
    plannerWritesPlan(store, plannerAgent);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "linear blip" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });

  it("includes relatedContext when the issue has a parent", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, linearClient, plannerAgent } = buildDeps(store);
    const parent = {
      id: "LIN-PARENT",
      title: "Parent issue",
      description: "d",
      state: "Todo",
      labels: [],
      priority: 0,
    };
    linearClient.getRelatedContext.mockResolvedValue({ parent, blockers: [] });
    plannerWritesPlan(store, plannerAgent);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    const bundle = (plannerAgent.run as unknown as { lastBundle: { relatedContext?: { parent?: unknown } } })
      .lastBundle;
    expect(bundle.relatedContext?.parent).toEqual(parent);
  });

  it("includes relatedContext when the issue has blockers", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, linearClient, plannerAgent } = buildDeps(store);
    const blocker = {
      id: "LIN-BLOCKER",
      title: "Blocker issue",
      description: "d",
      state: "In Progress",
      labels: [],
      priority: 1,
    };
    linearClient.getRelatedContext.mockResolvedValue({ blockers: [blocker] });
    plannerWritesPlan(store, plannerAgent);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    const bundle = (plannerAgent.run as unknown as { lastBundle: { relatedContext?: { blockers: unknown[] } } })
      .lastBundle;
    expect(bundle.relatedContext?.blockers).toEqual([blocker]);
  });

  it("omits relatedContext entirely when there is no parent and no blockers", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, linearClient, plannerAgent } = buildDeps(store);
    linearClient.getRelatedContext.mockResolvedValue({ blockers: [] });
    plannerWritesPlan(store, plannerAgent);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    const bundle = (plannerAgent.run as unknown as { lastBundle: { relatedContext?: unknown } }).lastBundle;
    expect(bundle.relatedContext).toBeUndefined();
  });

  it("proceeds without relatedContext and logs a warning when getRelatedContext throws", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, linearClient, plannerAgent, logger } = buildDeps(store);
    linearClient.getRelatedContext.mockRejectedValue(new Error("Linear API down"));
    plannerWritesPlan(store, plannerAgent);
    const svc = new OrchestratorService(deps as never);

    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "Linear API down" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
    const bundle = (plannerAgent.run as unknown as { lastBundle: { relatedContext?: unknown } }).lastBundle;
    expect(bundle.relatedContext).toBeUndefined();
  });
});
