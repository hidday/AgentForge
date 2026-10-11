import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, SkillDocument, RunEventRecord } from "../../src/domain/types.js";
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

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "Auth skill",
    description: "Handles auth",
    taskCategory: "auth",
    skillMarkdown: "# Auth",
    utilityScore: 0.5,
    lastUsedAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "SKILL_INJECTION",
    source: "orchestrator",
    payloadJson: null,
    createdAt: new Date(),
    ...overrides,
  };
}

interface TestStore {
  run: Run;
}

/**
 * Stateful run repo: `findById`, `update` and `updateState` all read/write a
 * shared store so that the run object's `state` field stays consistent
 * across the many sequential mutations `startRun`/`retryRun` perform --
 * mirroring a real database instead of requiring a brittle chain of
 * `mockResolvedValueOnce` calls.
 */
function buildDeps(initialRun: Run, overrides: Record<string, unknown> = {}) {
  const store: TestStore = { run: initialRun };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
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
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
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
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
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
    store,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    repoRegistry,
    plannerAgent,
    gitService,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one or calling the planner", async () => {
    const activeRun = makeRun({ id: "run-existing", state: RunState.Implementing });
    const { deps, runRepo, plannerAgent } = buildDeps(activeRun);
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toBe(activeRun);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(plannerAgent.run).not.toHaveBeenCalled();
  });

  it("creates a run, sets up the worktree, and proceeds through planning to plan review when there are no blocking questions", async () => {
    const todoRun = makeRun({ id: "run-new" });
    const { deps, runRepo } = buildDeps(todoRun);

    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const result = await svc.startRun("LIN-1");

    expect(runRepo.create).toHaveBeenCalled();
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-new");
    expect(result.state).toBe(RunState.PlanReview);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, workingDirectory: "/tmp" });
    const { deps, gitService } = buildDeps(run);

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
  });

  it("skips worktree setup and reuses the existing branch when branchName is already set", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Todo,
      branchName: "ai/existing-branch",
      workingDirectory: "/tmp/worktree",
    });
    const { deps, gitService } = buildDeps(run);

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the re-plan still has blocking open questions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing-branch" });
    const { deps, plannerAgent } = buildDeps(run);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "Which auth provider?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.buildTaskBundle (via startRun)", () => {
  it("uses the remote default branch and logs a warning when it differs from the configured value", async () => {
    const todoRun = makeRun({ id: "run-branch" });
    const { deps, githubClient, logger } = buildDeps(todoRun);
    githubClient.getDefaultBranch.mockResolvedValue("trunk");

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    const plannerCallBundle = (deps.plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      repo: { defaultBranch: string };
    };
    expect(plannerCallBundle.repo.defaultBranch).toBe("trunk");
  });

  it("falls back to the configured default branch and logs a warning when GitHub lookup throws", async () => {
    const todoRun = makeRun({ id: "run-branch-err" });
    const { deps, githubClient, logger } = buildDeps(todoRun);
    githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub unavailable"));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "GitHub unavailable" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    const plannerCallBundle = (deps.plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      repo: { defaultBranch: string };
    };
    expect(plannerCallBundle.repo.defaultBranch).toBe("main");
  });
});

describe("OrchestratorService skill retrieval and metrics (via agentSkillRepo)", () => {
  it("retrieveSkillsForPlanning returns [] and never queries the repo when agentSkillRepo is not configured", async () => {
    const todoRun = makeRun({ id: "run-skip-skills" });
    const { deps } = buildDeps(todoRun);

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.startRun("LIN-1");

    expect(deps.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-skip-skills",
      expect.objectContaining({ priorSkills: [] }),
    );
  });

  it("retrieveSkillsForPlanning queries the repo and records a SKILL_INJECTION event when skills are found", async () => {
    const todoRun = makeRun({ id: "run-skills", linearIssueTitle: "Add OAuth login" });
    const skill = makeSkill();
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([skill]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo } = buildDeps(todoRun, { agentSkillRepo });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Add OAuth login"),
      3,
    );
    const injectionEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
    ]);
  });

  it("updateSkillMetrics increments success and archives low-utility skills when the run succeeds (via approveHumanReview)", async () => {
    const run = makeRun({ id: "run-metrics", state: RunState.ReadyForHumanReview });
    const updatedSkill = { id: "skill-1", successCount: 6, failureCount: 1, utilityScore: 0.1 };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo } = buildDeps(run, { agentSkillRepo });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
      makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1", "skill-2"] } }),
    ]);

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-metrics");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });

  it("updateSkillMetrics logs a warning and continues when incrementSuccess throws for one skill", async () => {
    const run = makeRun({ id: "run-metrics-fail", state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo, logger } = buildDeps(run, { agentSkillRepo });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
    ]);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.approveHumanReview("run-metrics-fail")).resolves.toBeDefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-metrics-fail", skillId: "skill-1", error: "db down" }),
      "Failed to update skill metric",
    );
  });
});
