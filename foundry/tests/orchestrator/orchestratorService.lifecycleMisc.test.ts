import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";

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
    prNumber: 10,
    state: RunState.ReadyForHumanReview,
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
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
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

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
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
      distillationAgent,
      agentSkillRepo,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    gitService,
    logger,
    distillationAgent,
    agentSkillRepo,
  };
}

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const { deps, runRepo, linearClient, distillationAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Done"),
    );
    // Terminal state cleanup should run the worktree removal.
    expect(gitService.removeWorktree).toHaveBeenCalled();
    expect(result.state).toBe(RunState.Done);
  });

  it("continues (ignoring the error) when the distillation agent throws", async () => {
    const { deps, runRepo, linearClient, distillationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));

    const result = await svc.approveHumanReview("run-1");

    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
    expect(linearClient.postComment).toHaveBeenCalled();
    expect(result.state).toBe(RunState.Done);
  });

  it("skips distillation entirely when no distillationAgent dependency is configured", async () => {
    const { deps, runRepo } = buildDeps({ distillationAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});

describe("OrchestratorService -- requireRun", () => {
  it("throws a plain Error when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.approveHumanReview("missing-run")).rejects.toThrow(/Run not found/);
  });
});

describe("OrchestratorService -- transitionAndRecord terminal cleanup", () => {
  it("does not remove the worktree when workingDirectory equals the main repo path", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    gitService.resolveMainRepoPath.mockReturnValue("/tmp/worktree");
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Done, workingDirectory: "/tmp/worktree" }),
    );

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("updates skill metrics on success (Done) using the agentSkillRepo", async () => {
    const { deps, runRepo, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Done }));

    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
        createdAt: new Date(),
      },
      {
        id: "e2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-2"] },
        createdAt: new Date(),
      },
    ]);
    agentSkillRepo.incrementSuccess.mockResolvedValue({ id: "skill-1", utilityScore: 0.5 });

    await svc.approveHumanReview("run-1");

    // Deduplicated across injection events: skill-1 and skill-2 only, each once.
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("skips skill metrics work entirely when no SKILL_INJECTION events exist", async () => {
    const { deps, runRepo, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("swallows per-skill metric update errors and logs a warning", async () => {
    const { deps, runRepo, eventRepo, agentSkillRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    agentSkillRepo.incrementSuccess.mockRejectedValue(new Error("db down"));

    // Must not throw even though the per-skill update failed.
    await svc.approveHumanReview("run-1");

    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
  });
});

describe("OrchestratorService.startRun -- idempotency", () => {
  it("returns the existing active run without creating a new one", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ id: "existing-run", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(activeRun);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService -- retrieveSkillsForPlanning (via startRun)", () => {
  function setupStartRunHappyPath(deps: ReturnType<typeof buildDeps>["deps"], todoRun: Run) {
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1",
      title: "Add OAuth support",
      description: "Needs OAuth",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });
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
    (deps.repoRegistry.validateWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(
      undefined,
    );
    (deps.repoRegistry.getRepoByName as ReturnType<typeof vi.fn>).mockReturnValue({
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
    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(todoRun);
    (deps.gitService.setupRunWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-test",
    });
  }

  it("records a SKILL_INJECTION event when relevant skills are found", async () => {
    const { deps, runRepo, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo, linearIssueTitle: "Add OAuth support" });
    setupStartRunHappyPath(deps, todoRun);

    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-test" })
      .mockResolvedValue(
        makeRun({ state: RunState.Planning, planVersion: 1, linearIssueTitle: "Add OAuth support" }),
      );
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.PlanReview, linearIssueTitle: "Add OAuth support" }),
    );

    agentSkillRepo.findTopKByRelevance.mockResolvedValue([
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "Auth skill",
        description: null,
        taskCategory: "auth",
        skillMarkdown: "# Auth",
        utilityScore: 0.8,
        lastUsedAt: new Date(),
      },
    ]);

    deps.plannerAgent.run.mockResolvedValue({
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "t", description: "d" }],
      testPlan: "run",
      confidence: 0.9,
    });

    vi.spyOn(svc, "runPlanReview").mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Add OAuth support"),
      expect.any(Number),
    );

    const injectionCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeDefined();
    expect((injectionCall![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual(
      ["skill-1"],
    );
  });

  it("does not record a SKILL_INJECTION event when no skills are relevant", async () => {
    const { deps, runRepo, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo, linearIssueTitle: "Add OAuth support" });
    setupStartRunHappyPath(deps, todoRun);

    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-test" })
      .mockResolvedValue(
        makeRun({ state: RunState.Planning, planVersion: 1, linearIssueTitle: "Add OAuth support" }),
      );
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.PlanReview, linearIssueTitle: "Add OAuth support" }),
    );

    agentSkillRepo.findTopKByRelevance.mockResolvedValue([]);

    deps.plannerAgent.run.mockResolvedValue({
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "t", description: "d" }],
      testPlan: "run",
      confidence: 0.9,
    });

    vi.spyOn(svc, "runPlanReview").mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );

    await svc.startRun("LIN-1");

    const injectionCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeUndefined();
  });

  it("returns an empty skills array (no injection event, no crash) when agentSkillRepo is not configured", async () => {
    const { deps, runRepo, eventRepo } = buildDeps({ agentSkillRepo: undefined });
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo, linearIssueTitle: "Add OAuth support" });
    setupStartRunHappyPath(deps, todoRun);

    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-test" })
      .mockResolvedValue(
        makeRun({ state: RunState.Planning, planVersion: 1, linearIssueTitle: "Add OAuth support" }),
      );
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.PlanReview, linearIssueTitle: "Add OAuth support" }),
    );

    deps.plannerAgent.run.mockResolvedValue({
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "t", description: "d" }],
      testPlan: "run",
      confidence: 0.9,
    });

    vi.spyOn(svc, "runPlanReview").mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );

    await svc.startRun("LIN-1");

    const injectionCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeUndefined();
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.answerQuestions -- missing plan artifact", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.HumanClarificationNeeded }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact/);
  });
});

describe("OrchestratorService.runPlanReview / approvePlan -- missing plan artifact", () => {
  it("runPlanReview throws when there is no Plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Planning }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact/);
  });
});

describe("OrchestratorService.runManualReReview / runManualPlanRevision -- missing plan", () => {
  it("runManualPlanRevision throws when there is no Plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.PlanReview, linearIssueTitle: "Add OAuth support" }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact/);
  });
});
