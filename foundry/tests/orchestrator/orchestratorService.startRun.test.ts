import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";
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

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
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
      identifier: "ENG-1",
      title: "Test issue",
      description: "Test description",
      url: "https://linear.app/ENG-1",
      branchName: "hidday/lin-1-test-issue",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn(),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/repos/test-repo"),
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

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
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
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/repos/test-repo"),
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
    repoRegistry,
    gitService,
    plannerAgent,
    planReviewerAgent,
    dashboardEmitter,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one when one already exists", async () => {
    const { deps, runRepo, linearClient, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("happy path: creates the run, sets up the worktree, transitions through Planning/PlanReview, and delegates to plan review", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, gitService, repoRegistry, dashboardEmitter, planReviewerAgent } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const createdRun = makeRun({ id: "run-1", state: RunState.Todo, workingDirectory: "/repos/test-repo" });
    runRepo.create.mockResolvedValue(createdRun);

    const afterWorktreeUpdate = { ...createdRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" };
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 0 });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const awaitingApprovalRun = makeRun({
      id: "run-1",
      state: RunState.AwaitingPlanApproval,
      planVersion: 1,
    });

    runRepo.update
      .mockResolvedValueOnce(afterWorktreeUpdate) // worktree path/branch update
      .mockResolvedValueOnce({ ...planningRun, planVersion: 1, plannerRuntime: "claude-code" }); // planVersion update (state is Planning post-RUN_REQUESTED)

    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED (inside runPlanReview)

    // requireRun inside runPlanReview
    runRepo.findById.mockResolvedValue(planReviewRun);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
      return Promise.resolve(null);
    });

    const result = await svc.startRun("LIN-1");

    // Run created with the resolved repo entry and working directory
    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "ENG-1",
        linearIssueTitle: "Test issue",
        repo: "test-repo",
        workingDirectory: "/repos/test-repo",
      }),
    );

    // Worktree set up using the pre-worktree working directory
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "run-1",
      "main",
      "hidday/lin-1-test-issue",
    );
    expect(repoRegistry.validateWorkingDirectory).toHaveBeenCalledWith("/repos/test-repo");

    // Dashboard notified of run creation
    expect(dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");

    // State transitions recorded: RUN_REQUESTED then PLAN_CREATED
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.RUN_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);

    // Delegated into plan review, which approved and returned AwaitingPlanApproval
    expect(planReviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("injects prior skills into the planner call and records a SKILL_INJECTION event when agentSkillRepo finds relevant skills", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([
        { id: "skill-1", repoSlug: "test-repo", name: "Auth patterns", description: null, taskCategory: "auth", skillMarkdown: "# Auth", utilityScore: 0.8, lastUsedAt: new Date() },
      ]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const createdRun = makeRun({
      id: "run-1",
      state: RunState.Todo,
      linearIssueTitle: "Add OAuth support",
      workingDirectory: "/repos/test-repo",
    });
    runRepo.create.mockResolvedValue(createdRun);
    const afterWorktree = { ...createdRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" };
    // transitionAndRecord replaces `run` with whatever updateState resolves to,
    // so the run passed into retrieveSkillsForPlanning is THIS object -- it must
    // carry the same linearIssueTitle for the relevance query to see it.
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning, linearIssueTitle: "Add OAuth support" });
    runRepo.update
      .mockResolvedValueOnce(afterWorktree)
      .mockResolvedValueOnce({ ...planningRun, planVersion: 1, plannerRuntime: "claude-code" });
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 }));
    runRepo.findById.mockResolvedValue(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 }));

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );

    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }));

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Add OAuth support"),
      expect.any(Number),
    );

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        priorSkills: [expect.objectContaining({ id: "skill-1" })],
      }),
    );

    const injectionEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson).toEqual({
      skillIds: ["skill-1"],
    });
  });

  it("does not record a SKILL_INJECTION event when no relevant skills are found", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, artifactRepo, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const createdRun = makeRun({ id: "run-1", state: RunState.Todo, workingDirectory: "/repos/test-repo" });
    runRepo.create.mockResolvedValue(createdRun);
    const afterWorktree = { ...createdRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" };
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    runRepo.update
      .mockResolvedValueOnce(afterWorktree)
      .mockResolvedValueOnce({ ...planningRun, planVersion: 1, plannerRuntime: "claude-code" });
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 }));
    runRepo.findById.mockResolvedValue(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 }));

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }));

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalled();
    const injectionEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeUndefined();
  });

  it("propagates a policy violation when the freshly created run is not plannable (defensive branch)", async () => {
    // assertCanPlan is asserted right after run creation on the *pre-transition*
    // run (state Todo), so this exercises the guard without needing an invalid
    // state — it should simply pass through. This test instead verifies the
    // rejection path (a run that is somehow not Todo/Planning at that point,
    // e.g. Done) throws a PolicyViolationError and does not proceed to worktree
    // creation's downstream steps beyond that point.
    const { deps, runRepo, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const createdRun = makeRun({ id: "run-1", state: RunState.Done });
    runRepo.create.mockResolvedValue(createdRun);
    runRepo.update.mockResolvedValue({ ...createdRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" });

    await expect(svc.startRun("LIN-1")).rejects.toThrow(/Cannot plan when run is in state/);
    expect(gitService.setupRunWorktree).toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet, then proceeds through planning to plan review", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, gitService, repoRegistry, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, workingDirectory: "/repos/test-repo" });
    const afterWorktree = { ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" };
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });

    // First call: requireRun() inside retryRun itself. Second call onward:
    // requireRun() inside runPlanReview(), which needs the PlanReview state.
    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);

    runRepo.update
      .mockResolvedValueOnce(afterWorktree)
      .mockResolvedValueOnce({ ...planningRun, planVersion: 1, plannerRuntime: "claude-code" });

    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
      return Promise.resolve(null);
    });

    const result = await svc.retryRun("run-1");

    expect(gitService.resolveMainRepoPath).toHaveBeenCalledWith("/repos/test-repo");
    expect(repoRegistry.getRepoByName).toHaveBeenCalledWith("test-repo");
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "run-1",
      "main",
      "hidday/lin-1-test-issue",
    );
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ workingDirectory: "/tmp/worktree", branchName: "ai/run-1" }),
    );
    expect(planReviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    void eventRepo;
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const { deps, runRepo, artifactRepo, gitService, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({
      id: "run-1",
      state: RunState.Todo,
      branchName: "ai/existing-branch",
      workingDirectory: "/tmp/worktree",
    });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });

    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);

    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 1, plannerRuntime: "claude-code" });
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
      return Promise.resolve(null);
    });

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(planReviewerAgent.run).toHaveBeenCalledTimes(1);
  });

  it("falls back to repoRegistry.getDefaultRepo() when getRepoByName returns nothing", async () => {
    const { deps, runRepo, artifactRepo, gitService, repoRegistry, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, repo: "unknown-repo", workingDirectory: "/repos/unknown" });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });

    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);
    (repoRegistry.getRepoByName as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);

    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValueOnce({ ...planningRun, planVersion: 1, plannerRuntime: "claude-code" });
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
      return Promise.resolve(null);
    });

    await svc.retryRun("run-1");

    expect(repoRegistry.getRepoByName).toHaveBeenCalledWith("unknown-repo");
    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
    expect(gitService.resolveMainRepoPath).toHaveBeenCalledWith("/repos/unknown");
    // Falls back to the default repo's defaultBranch ("main") for the worktree setup
    // (mainWorkingDir comes from the mocked resolveMainRepoPath return value).
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "run-1",
      "main",
      "hidday/lin-1-test-issue",
    );
    expect(planReviewerAgent.run).toHaveBeenCalledTimes(1);
  });

  it("pauses for human clarification when the re-plan has blocking open questions, without calling runPlanReview", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, planReviewerAgent, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing-branch" });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const clarificationRun = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });

    runRepo.findById.mockResolvedValue(todoRun);
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 1, plannerRuntime: "claude-code" });
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 })) // PLAN_CREATED
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );

    const result = await svc.retryRun("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });

  it("throws StateTransitionError when the run is not in a state that allows RUN_REQUESTED", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    // branchName is already set so the worktree-setup branch (and its own
    // runRepo.update call) is skipped, isolating the RUN_REQUESTED transition.
    const doneRun = makeRun({ id: "run-1", state: RunState.Done, branchName: "ai/already-set" });
    runRepo.findById.mockResolvedValue(doneRun);

    await expect(svc.retryRun("run-1")).rejects.toThrow(StateTransitionError);
    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.retryRun("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});
