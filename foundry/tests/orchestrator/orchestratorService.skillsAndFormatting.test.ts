import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Some description text",
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Green.",
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

function buildDeps(store: TestStore, agentSkillRepoOverrides?: Record<string, unknown>) {
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

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

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
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
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

  const agentSkillRepo = agentSkillRepoOverrides
    ? {
        findTopKByRelevance: vi.fn().mockResolvedValue([]),
        incrementSuccess: vi.fn(),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
        ...agentSkillRepoOverrides,
      }
    : undefined;

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
      ...(agentSkillRepo ? { agentSkillRepo } : {}),
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    executorAgent,
    plannerAgent,
    logger,
    agentSkillRepo,
  };
}

describe("OrchestratorService -- retrieveSkillsForPlanning", () => {
  it("passes an empty priorSkills list to the planner when no agentSkillRepo is configured", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Todo, branchName: null }), artifacts: [] };
    const { deps, plannerAgent } = buildDeps(store);
    (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
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
    });
    (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
    (deps.gitService.setupRunWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({ ...store.run });
    const plan = makePlan({ openQuestions: [] });
    plannerAgent.run.mockImplementation(() => {
      store.artifacts.push(makeArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
      return Promise.resolve(plan);
    });
    (deps.planReviewerAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    const svc = new OrchestratorService(deps as never);
    await svc.startRun("LIN-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ priorSkills: [] }),
    );
  });

  it("records a SKILL_INJECTION event when relevant skills are found", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Todo, branchName: null }), artifacts: [] };
    const findTopKByRelevance = vi.fn().mockResolvedValue([
      { id: "skill-1", repoSlug: "test-repo", name: "n", description: "d", taskCategory: "cat", skillMarkdown: "md", utilityScore: 1, lastUsedAt: new Date() },
    ]);
    const { deps, eventRepo } = buildDeps(store, { findTopKByRelevance });
    (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
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
    });
    (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
    (deps.gitService.setupRunWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({ ...store.run });
    const plan = makePlan({ openQuestions: [] });
    (deps.plannerAgent.run as ReturnType<typeof vi.fn>).mockImplementation(() => {
      store.artifacts.push(makeArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
      return Promise.resolve(plan);
    });
    (deps.planReviewerAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    const svc = new OrchestratorService(deps as never);
    await svc.startRun("LIN-1");

    const injectionEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
    expect(
      (injectionEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds,
    ).toEqual(["skill-1"]);
  });
});

describe("OrchestratorService -- buildTaskBundle default branch resolution", () => {
  it("prefers the remote default branch and warns when it differs from config", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const { deps, githubClient, logger, plannerAgent } = buildDeps(store);
    githubClient.getDefaultBranch.mockResolvedValue("develop");
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanning("run-1").catch(() => undefined);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    const call = plannerAgent.run.mock.calls[0];
    expect((call[0] as { repo: { defaultBranch: string } }).repo.defaultBranch).toBe("develop");
  });
});

describe("OrchestratorService -- formatExecutionReportComment rendering", () => {
  it("collapses the file list inside <details> when more than 8 files changed, and renders notes", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const { deps, executorAgent, linearClient } = buildDeps(store);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: manyFiles, notes: ["Watch out for X"] }),
      prNumber: 3,
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runExecution("run-1").catch(() => undefined);

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("<details>");
    expect(comment![1]).toContain("Files changed (9)");
    expect(comment![1]).toContain("### Notes");
    expect(comment![1]).toContain("Watch out for X");
  });

  it("renders a plain (non-collapsed) file list when 8 or fewer files changed", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const { deps, executorAgent, linearClient } = buildDeps(store);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"] }),
      prNumber: 3,
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runExecution("run-1").catch(() => undefined);

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).not.toContain("<details>");
    expect(comment![1]).toContain("Files changed (2)");
  });
});
