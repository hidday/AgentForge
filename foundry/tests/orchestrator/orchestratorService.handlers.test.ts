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
    branchName: null,
    prNumber: null,
    state: RunState.Planning,
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
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

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
    githubClient,
    logger,
    agentSkillRepo,
  };
}

describe("OrchestratorService -- accessors", () => {
  it("exposes the injected repositories and clients unchanged", () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });

  it("getAgentSkillRepo returns undefined when not injected", () => {
    const { deps } = buildDeps({ agentSkillRepo: undefined });
    const svc = new OrchestratorService(deps as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("does nothing for issue.created", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing for issue.updated", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("delegates to handleCommand for comment.command when a command is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    const command = { type: "unknown" as const };
    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(spy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does nothing for comment.command when no command is attached", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("dispatches ai-plan to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("dispatches run-ai to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan calls approvePlan then runExecution when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).toHaveBeenCalledWith("run-42");
    expect(execSpy).toHaveBeenCalledWith("run-42");
  });

  it("approve-plan is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approveSpy = vi.spyOn(svc, "approvePlan");
    const execSpy = vi.spyOn(svc, "runExecution");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("reject-plan calls rejectPlan with the comment body and linear source when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const spy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

    expect(spy).toHaveBeenCalledWith("run-42", "needs more detail", "linear");
  });

  it("reject-plan is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const spy = vi.spyOn(svc, "rejectPlan");

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("re-review calls runReview when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const spy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(spy).toHaveBeenCalledWith("run-42");
  });

  it("re-review is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const spy = vi.spyOn(svc, "runReview");

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("pause-ai transitions the active run to AIBlocked via BLOCKED", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.BLOCKED, source: "user-command" }),
    );
    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
  });

  it("pause-ai is a no-op when there is no active run", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(eventRepo.create).not.toHaveBeenCalled();
  });

  it("resume-ai transitions a blocked run back to Todo via RESET_TO_TODO", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.RESET_TO_TODO, source: "user-command" }),
    );
    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
  });

  it("resume-ai is a no-op when there is no active run", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(eventRepo.create).not.toHaveBeenCalled();
  });

  it("logs a warning and does nothing for an unknown command", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});

describe("OrchestratorService.startRun -- existing active run", () => {
  it("returns the existing active run without re-fetching from Linear or creating a new run", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const existing = makeRun({ id: "run-existing", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(linearClient.getIssue).not.toHaveBeenCalled();
    expect(runRepo.create).not.toHaveBeenCalled();
  });
});
