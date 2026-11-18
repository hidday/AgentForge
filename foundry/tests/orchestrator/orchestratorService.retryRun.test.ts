import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
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
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    gitService,
    logger,
    repoRegistry,
  };
}

function plannerWritesPlan(
  store: Store,
  plannerAgent: { run: ReturnType<typeof vi.fn> },
  plan: (opts: Record<string, unknown> | undefined) => Plan,
) {
  plannerAgent.run.mockImplementation(
    (_bundle: unknown, _runId: string, opts?: Record<string, unknown>) => {
      const p = plan(opts);
      store.artifacts.push(asArtifact({ type: "Plan", version: p.planVersion, payloadJson: p }));
      return Promise.resolve(p);
    },
  );
}

describe("OrchestratorService.retryRun", () => {
  it("throws when the run does not exist", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store);
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.retryRun("missing")).rejects.toThrow(/Run not found/);
  });

  it("sets up a fresh worktree when the run has no branchName yet", async () => {
    const store: Store = { run: makeRun({ branchName: null }), artifacts: [], events: [] };
    const { deps, plannerAgent, gitService } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 1, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledTimes(1);
    expect(store.run.branchName).toBe("ai/run-1");
    expect(store.run.workingDirectory).toBe("/tmp/.worktrees/run-1");
  });

  it("does not set up a worktree when the run already has a branchName", async () => {
    const store: Store = { run: makeRun({ branchName: "ai/existing" }), artifacts: [], events: [] };
    const { deps, plannerAgent, gitService } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 1, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(store.run.branchName).toBe("ai/existing");
  });

  it("falls back to the registry's default repo when getRepoByName returns nothing", async () => {
    const store: Store = { run: makeRun({ branchName: null, repo: "unknown-repo" }), artifacts: [], events: [] };
    const { deps, plannerAgent, repoRegistry } = buildDeps(store);
    (repoRegistry.getRepoByName as ReturnType<typeof vi.fn>).mockReturnValue(null);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 1, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });

  it("transitions Todo -> Planning -> PlanReview -> AwaitingPlanApproval on the happy path", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, plannerAgent, planReviewerAgent, eventRepo, linearClient } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 1, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.retryRun("run-1");

    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    expect(planReviewerAgent.run).toHaveBeenCalled();
    expect(linearClient.postComment).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("creates the TaskBundle artifact for later re-use", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, plannerAgent, artifactRepo } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 1, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    const bundleCalls = artifactRepo.create.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === "TaskBundle",
    );
    expect(bundleCalls).toHaveLength(1);
  });

  it("pauses for human clarification when the plan has blocking questions", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, plannerAgent, planReviewerAgent, eventRepo } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({
        planVersion: (opts?.planVersionOverride as number) ?? 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.retryRun("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.NEEDS_HUMAN_CLARIFICATION,
    ]);
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("uses prior skills for planning when an agentSkillRepo is configured", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([
        {
          id: "skill-1",
          repoSlug: "test-repo",
          name: "n",
          description: "d",
          taskCategory: "cat",
          skillMarkdown: "md",
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        },
      ]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, plannerAgent, eventRepo } = buildDeps(store, { agentSkillRepo });
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 1, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: expect.arrayContaining([expect.objectContaining({ id: "skill-1" })]) }),
    );
    const skillInjectionEvent = eventRepo.create.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillInjectionEvent).toBeDefined();
  });

  it("does not record a SKILL_INJECTION event when the agentSkillRepo finds no relevant skills", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, plannerAgent, eventRepo } = buildDeps(store, { agentSkillRepo });
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 1, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.retryRun("run-1");

    const skillInjectionEvent = eventRepo.create.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillInjectionEvent).toBeUndefined();
  });
});
