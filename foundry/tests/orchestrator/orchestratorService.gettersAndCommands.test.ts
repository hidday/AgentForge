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
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
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
    create: vi.fn(),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
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
    getRepoByName: vi.fn().mockReturnValue(null),
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

  const agentSkillRepo = {
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    agentSkillRepo,
    logger,
  };
}

describe("OrchestratorService accessors", () => {
  it("exposes the injected repositories and clients via getters", () => {
    const { deps, runRepo, artifactRepo, eventRepo, agentSkillRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
  });

  it("getAgentSkillRepo returns undefined when the dependency was not supplied", () => {
    const { deps } = buildDeps({ agentSkillRepo: undefined });
    const svc = new OrchestratorService(deps as never);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("issue.created action: logs and takes no action", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("issue.updated action: logs and takes no action", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("comment.command action without a command payload: does not call handleCommand", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("comment.command action with a command payload: delegates to handleCommand", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "reject-plan", body: "no good" },
    });

    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("'unknown' command type: logs a warning and takes no action", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });

  it("'approve-plan': no-ops when there is no active run for the issue", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("'approve-plan': approves the plan and then starts execution when an active run exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.findById.mockResolvedValue(activeRun);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "artifact-plan",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { planVersion: 1 },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue({ ...activeRun, approvedPlanVersion: 1 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    // runExecution will be invoked next; it requires the run to be Implementing with a
    // matching approved plan version. Let policy.assertCanExecute throw naturally by
    // making the second findById call return the Implementing run without the plan artifact
    // update reflected -- we only assert that approvePlan's side effects happened and that
    // execution was attempted (its downstream failure, if any, is not swallowed).
    await expect(svc.handleCommand("LIN-1", { type: "approve-plan" })).rejects.toThrow();

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 1 });
  });

  it("'reject-plan': no-ops when there is no active run for the issue", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "nope" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("'re-review': no-ops when there is no active run for the issue", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("'pause-ai': no-ops when there is no active run for the issue", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("'pause-ai': transitions the active run with BLOCKED via transitionAndRecord", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", eventType: RunEvent.BLOCKED, source: "user-command" }),
    );
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
  });

  it("'resume-ai': no-ops when there is no active run for the issue", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("'resume-ai': transitions the active run with RESET_TO_TODO via transitionAndRecord", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const todoRun = makeRun({ state: RunState.Todo });
    runRepo.updateState.mockResolvedValue(todoRun);
    // AIBlocked -> Todo is not Done/Failed, so no worktree cleanup is triggered.

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        eventType: RunEvent.RESET_TO_TODO,
        source: "user-command",
      }),
    );
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Todo);
  });

  it("'ai-plan' delegates to startRun", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    // Existing active run short-circuits startRun's work, keeping this test focused
    // on dispatch (the ai-plan/run-ai branch calling startRun).
    const activeRun = makeRun({ state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const result = await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(result).toBeUndefined();
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
  });

  it("'run-ai' delegates to startRun", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
  });
});
