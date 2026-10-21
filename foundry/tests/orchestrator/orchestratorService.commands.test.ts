import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
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
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
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
    runRepo,
    eventRepo,
    linearSync,
    githubSync,
    logger,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command with a command payload to handleCommand", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" } as never,
    });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does not call handleCommand for comment.command when no command is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await expect(
      svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await expect(
      svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("starts a run for ai-plan", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" } as never);

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("starts a run for run-ai", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" } as never);

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approves the plan and starts execution when an active run exists for approve-plan", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun();
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);

    expect(approvePlanSpy).toHaveBeenCalledWith(run.id);
    expect(runExecutionSpy).toHaveBeenCalledWith(run.id);
  });

  it("does nothing for approve-plan when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);

    expect(approvePlanSpy).not.toHaveBeenCalled();
    expect(runExecutionSpy).not.toHaveBeenCalled();
  });

  it("rejects the plan with the command body when an active run exists for reject-plan", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun();
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" } as never);

    expect(rejectPlanSpy).toHaveBeenCalledWith(run.id, "needs more detail", "linear");
  });

  it("does nothing for reject-plan when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" } as never);

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("triggers re-review when an active run exists for re-review", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun();
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" } as never);

    expect(runReviewSpy).toHaveBeenCalledWith(run.id);
  });

  it("does nothing for re-review when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" } as never);

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("transitions an active run to AIBlocked for pause-ai", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);

    expect(runRepo.updateState).toHaveBeenCalledWith(run.id, RunState.AIBlocked);
  });

  it("does nothing for pause-ai when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resets a blocked run to Todo for resume-ai", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);

    expect(runRepo.updateState).toHaveBeenCalledWith(run.id, RunState.Todo);
  });

  it("does nothing for resume-ai when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("logs a warning and takes no action for an unknown command", async () => {
    const { deps, runRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" } as never);

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});
