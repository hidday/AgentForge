import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, SkillDocument } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Some description text",
    linearIssueTitle: "Some title",
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

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
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
    name: "Auth pattern",
    description: "How to add auth",
    taskCategory: "auth",
    skillMarkdown: "# Auth\nDo X.",
    utilityScore: 0.5,
    lastUsedAt: new Date(),
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
    create: vi.fn().mockResolvedValue({}),
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

  const plannerAgent = { run: vi.fn() };
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
    githubClient,
    gitService,
    plannerAgent,
    logger,
  };
}

describe("OrchestratorService.buildTaskBundle -- default branch resolution", () => {
  it("uses the remote GitHub default branch and warns when it differs from the config value", async () => {
    const { deps, runRepo, artifactRepo, linearClient, githubClient, plannerAgent, logger } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    runRepo.findById
      .mockResolvedValueOnce(initialRun)
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    githubClient.getDefaultBranch.mockResolvedValue("develop");
    (
      deps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }
    ).planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.rejectPlan("run-1", "feedback");

    expect(githubClient.getDefaultBranch).toHaveBeenCalledWith("test-repo");
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" &&
        (c[1] as string).includes("Config defaultBranch differs from GitHub"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { config: string; remote: string }).config).toBe("main");
    expect((warnCall![0] as { config: string; remote: string }).remote).toBe("develop");

    const passedBundle = (plannerAgent.run.mock.calls[0][0] as TaskBundle);
    expect(passedBundle.repo.defaultBranch).toBe("develop");
    void linearClient;
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning", () => {
  it("injects prior skills, calls plannerAgent with them, and records a SKILL_INJECTION event", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([makeSkill({ id: "skill-1" }), makeSkill({ id: "skill-2" })]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, plannerAgent } = buildDeps({
      agentSkillRepo,
    });
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
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
    (deps.repoRegistry.validateWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    runRepo.create.mockResolvedValue(todoRun);
    (deps.gitService.setupRunWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Todo, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const plan = makePlan({ openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    (
      deps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }
    ).planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Some title"),
      expect.any(Number),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      todoRun.id,
      expect.objectContaining({ priorSkills: [expect.objectContaining({ id: "skill-1" }), expect.objectContaining({ id: "skill-2" })] }),
    );
    const injectionEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
      "skill-2",
    ]);
    void linearClient;
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
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
    (deps.repoRegistry.validateWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    runRepo.create.mockResolvedValue(todoRun);
    (deps.gitService.setupRunWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Todo }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const plan = makePlan({ openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    (
      deps as unknown as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }
    ).planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.startRun("LIN-1");

    const injectionEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeUndefined();
  });
});

describe("OrchestratorService.updateSkillMetrics (via transitionAndRecord reaching a terminal state)", () => {
  it("increments success and archives low-utility skills when the run completes successfully (Done)", async () => {
    const updatedSkill = { id: "skill-1", successCount: 3, failureCount: 0, utilityScore: 0.75 };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, runRepo, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });

  it("deduplicates skill IDs across multiple SKILL_INJECTION events and swallows per-skill errors when the run fails", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi
        .fn()
        .mockRejectedValueOnce(new Error("db write failed"))
        .mockResolvedValueOnce({ id: "skill-2", successCount: 0, failureCount: 1, utilityScore: 0.1 }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, runRepo, artifactRepo, eventRepo, logger, plannerAgent } = buildDeps({
      agentSkillRepo,
    });
    const svc = new OrchestratorService(deps as never);

    // Drive the run to Failed via answerQuestions' CLARIFICATION_EXHAUSTED branch
    // (max clarification iterations reached), mirroring
    // orchestratorService.clarification.test.ts's equivalent scenario, but with
    // agentSkillRepo configured so updateSkillMetrics actually runs.
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
    });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed })); // CLARIFICATION_EXHAUSTED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: taskBundle }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    // 3 prior NEEDS_HUMAN_CLARIFICATION events (max iterations reached) plus two
    // SKILL_INJECTION events whose skillIds overlap.
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
      {
        id: "evt-2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
        createdAt: new Date(),
      },
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still confused" }]);

    expect(result.state).toBe(RunState.Failed);
    // Deduplicated to 2 unique skill IDs: skill-1 (called once despite appearing
    // in two events) and skill-2.
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-2");
    // The failed incrementFailure call is caught and logged, not thrown.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db write failed" }),
      "Failed to update skill metric",
    );
    // archiveIfLowUtility is only called for the skill whose update succeeded.
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});

describe("OrchestratorService dependency accessors", () => {
  it("expose the underlying repositories and Linear client passed in at construction", () => {
    const { deps, runRepo, artifactRepo, eventRepo } = buildDeps();
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
  });

  it("getAgentSkillRepo returns undefined when no skill repo was configured", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("approves the plan, transitions to Implementing, and posts a plain comment without an operator note", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const plan = makePlan({ planVersion: 3 });
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue({ payloadJson: plan });
    runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 3 }),
    );
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v3 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment and the recorded event payload", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildDeps();
    const plan = makePlan({ planVersion: 5 });
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue({ payloadJson: plan });
    runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 5 }),
    );
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1", { note: "Looks good, ship it" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v5 approved with operator note. Starting implementation...\n\n> Looks good, ship it",
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: RunEvent.PLAN_APPROVED,
        payloadJson: expect.objectContaining({ note: "Looks good, ship it" }),
      }),
    );
  });
});

describe("OrchestratorService worktree cleanup on terminal transitions", () => {
  it("removes the worktree when the run's working directory differs from the resolved main repo path", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    (gitService as { resolveMainRepoPath: ReturnType<typeof vi.fn> }).resolveMainRepoPath =
      vi.fn().mockReturnValue("/repos/myrepo");
    const run = makeRun({
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/repos/myrepo/.worktrees/run-abc",
    });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Done, workingDirectory: "/repos/myrepo/.worktrees/run-abc" }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith(
      "/repos/myrepo",
      "/repos/myrepo/.worktrees/run-abc",
    );
  });

  it("skips worktree removal when the working directory already IS the main repo path", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/tmp" }));
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });
});
