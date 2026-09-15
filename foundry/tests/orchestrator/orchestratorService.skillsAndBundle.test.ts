import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RunEventRecord, SkillDocument } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Do the thing",
    linearIssueTitle: "Do the thing",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: `artifact-${overrides.type}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> & { eventType: string }): RunEventRecord {
  return {
    id: `event-${Math.random()}`,
    runId: "run-1",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "Handle retries",
    description: "How to handle flaky retries",
    taskCategory: "backend",
    skillMarkdown: "# Retry handling",
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
      branchName: "hidday/lin-1-test",
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
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
      distillationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    plannerAgent,
    planReviewerAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.retrieveSkillsForPlanning (exercised via startRun)", () => {
  it("passes an empty priorSkills array and skips SKILL_INJECTION when no agentSkillRepo is configured", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const plan = makePlan({ openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.startRun("LIN-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [] }),
    );
    const skillEvents = eventRepo.create.mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvents).toHaveLength(0);
  });

  it("injects retrieved skills into the planner call and records a SKILL_INJECTION event", async () => {
    const skill = makeSkill();
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([skill]),
    };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, planReviewerAgent } = buildDeps({
      agentSkillRepo,
    });
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const plan = makePlan({ openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Do the thing"),
      expect.any(Number),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [skill] }),
    );
    const skillEventCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEventCall).toBeDefined();
    expect(
      (skillEventCall![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds,
    ).toEqual(["skill-1"]);
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, planReviewerAgent } = buildDeps({
      agentSkillRepo,
    });
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const plan = makePlan({ openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.startRun("LIN-1");

    const skillEvents = eventRepo.create.mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvents).toHaveLength(0);
  });
});

describe("OrchestratorService.updateSkillMetrics (exercised via approveHumanReview -> Done)", () => {
  it("does nothing when no agentSkillRepo is configured", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("does nothing when there are no SKILL_INJECTION events for the run", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("increments success (deduplicated) and archives low-utility skills when the run reaches Done", async () => {
    const updatedSkill = makeSkill({ id: "skill-1", utilityScore: 0.1 });
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, runRepo, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1", "skill-2"] } }),
      // Second injection event re-injects skill-1 (e.g. after a re-plan) -- must be deduplicated.
      makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
    ]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });

  it("increments failure (not success) when the run transitions to Failed", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(makeSkill()),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, runRepo, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    // Drive a run into Failed via the clarification-exhausted route, reached
    // through answerQuestions when required questions remain unresolved after
    // MAX_CLARIFICATION_ITERATIONS prior clarification rounds.
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed })); // CLARIFICATION_EXHAUSTED

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const { artifactRepo, plannerAgent } = buildDepsArtifacts(deps, plan);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: plan.planVersion }));
    void artifactRepo;
    void plannerAgent;

    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
      makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" }),
      makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" }),
      makeEvent({ eventType: "NEEDS_HUMAN_CLARIFICATION" }),
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("logs a warning and continues when incrementSuccess throws for one skill", async () => {
    const workingSkill = makeSkill({ id: "skill-2" });
    const agentSkillRepo = {
      incrementSuccess: vi
        .fn()
        .mockRejectedValueOnce(new Error("db unavailable"))
        .mockResolvedValueOnce(workingSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, runRepo, eventRepo, logger } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1", "skill-2"] } }),
    ]);

    await svc.approveHumanReview("run-1");

    // Both ids attempted despite the first failing (best-effort loop).
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    // Only the successful one reaches archiveIfLowUtility.
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(workingSkill);

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "string" && (call[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { skillId: string; error: string }).skillId).toBe("skill-1");
    expect((warnCall![0] as { skillId: string; error: string }).error).toBe("db unavailable");
  });
});

// Small helper used only by the Failed-transition test above to keep its
// Plan/TaskBundle artifact plumbing out of the main test body.
function buildDepsArtifacts(
  deps: { artifactRepo: { findLatestByType: ReturnType<typeof vi.fn> }; plannerAgent: { run: ReturnType<typeof vi.fn> } },
  plan: Plan,
) {
  deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
    if (type === "TaskBundle")
      return Promise.resolve(
        makeArtifact({
          type: "TaskBundle",
          payloadJson: {
            issue: { id: "LIN-1", title: "T", description: "D", labels: [], priority: 0 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/run-1",
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
          },
        }),
      );
    return Promise.resolve(null);
  });
  deps.plannerAgent.run.mockResolvedValue(plan);
  return { artifactRepo: deps.artifactRepo, plannerAgent: deps.plannerAgent };
}

describe("OrchestratorService buildTaskBundle -- default branch resolution", () => {
  it("uses the remote default branch and logs a warning when it differs from config", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, githubClient, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });

    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 }));
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 3 });

    const plan = makePlan({ planVersion: 3, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    githubClient.getDefaultBranch.mockResolvedValue("develop");
    (deps as never as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue(
      { overallVerdict: "approved", summary: "OK", findings: [] },
    );

    await svc.rejectPlan("run-1");

    const plannerCall = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const bundle = plannerCall[0] as { repo: { defaultBranch: string } };
    expect(bundle.repo.defaultBranch).toBe("develop");

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "string" &&
        (call[1] as string).includes("differs from GitHub"),
    );
    expect(warnCall).toBeDefined();
  });

  it("falls back to the configured default branch and logs a warning when GitHub lookup fails", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, githubClient, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });

    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 }));
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 3 });

    const plan = makePlan({ planVersion: 3, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub API down"));
    (deps as never as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue(
      { overallVerdict: "approved", summary: "OK", findings: [] },
    );

    await svc.rejectPlan("run-1");

    const plannerCall = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    const bundle = plannerCall[0] as { repo: { defaultBranch: string } };
    expect(bundle.repo.defaultBranch).toBe("main");

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "string" &&
        (call[1] as string).includes("Failed to resolve default branch"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("GitHub API down");
  });
});

describe("OrchestratorService cleanupRunWorktree (exercised via a Done transition)", () => {
  it("removes the worktree when it differs from the main repo path", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo/.worktrees/run-1" });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Done, workingDirectory: "/repo/.worktrees/run-1" }),
    );
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/.worktrees/run-1");
  });

  it("does not remove the worktree when it already equals the main repo path", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo" });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/repo" }));
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });
});
