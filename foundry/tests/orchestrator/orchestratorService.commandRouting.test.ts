import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearCommand } from "../../src/linear/linearCommandParser.js";

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

function buildDeps() {
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
    create: vi.fn(),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
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

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn(),
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
    findActiveByRepo: vi.fn(),
    countActiveByRepo: vi.fn(),
    create: vi.fn(),
    displaceAndCreate: vi.fn(),
    findById: vi.fn(),
    findLowestUtilityActive: vi.fn(),
    archiveById: vi.fn(),
    findTopKByRelevance: vi.fn(),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
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
      agentSkillRepo,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    logger,
    agentSkillRepo,
  };
}

describe("OrchestratorService accessors", () => {
  it("exposes the injected repositories and linear client via getters", () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });

  it("getAgentSkillRepo returns undefined when not injected", () => {
    const { deps } = buildDeps();
    const depsWithoutSkillRepo = { ...deps, agentSkillRepo: undefined };
    const svc = new OrchestratorService(depsWithoutSkillRepo as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs and no-ops on issue.created", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { action: "issue.created", issueId: "LIN-1" },
      "Handling Linear webhook",
    );
  });

  it("logs and no-ops on issue.updated", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("delegates to handleCommand when action is comment.command and a command is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);
    const command: LinearCommand = { type: "unknown", raw: "/bogus" };

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does NOT call handleCommand when action is comment.command but command is absent", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["ai-plan", "run-ai"] as const)("routes '%s' to startRun", async (type) => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  describe("approve-plan", () => {
    it("calls approvePlan then runExecution when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun();
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
      const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).toHaveBeenCalledWith("run-1");
      expect(runExecutionSpy).toHaveBeenCalledWith("run-1");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan");

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("reject-plan", () => {
    it("calls rejectPlan with the command body and source='linear' when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun();
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs work" });

      expect(rejectPlanSpy).toHaveBeenCalledWith("run-1", "needs work", "linear");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" });

      expect(rejectPlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("re-review", () => {
    it("calls runReview when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun();
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const runReviewSpy = vi.spyOn(svc, "runReview");

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause-ai", () => {
    it("transitions the active run to AIBlocked via BLOCKED event", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ state: RunState.Implementing });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
      const eventCall = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
      );
      expect(eventCall).toBeDefined();
      expect((eventCall![0] as { source: string }).source).toBe("user-command");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("resume-ai", () => {
    it("transitions the active run back to Todo via RESET_TO_TODO event", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ state: RunState.AIBlocked });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Todo);
      const eventCall = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
      );
      expect(eventCall).toBeDefined();
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  it("logs a warning and does nothing for an unknown command", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "LIN-1", command: { type: "unknown", raw: "/bogus" } },
      "Unknown command received",
    );
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});
