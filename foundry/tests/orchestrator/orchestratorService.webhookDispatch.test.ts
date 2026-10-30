import { describe, it, expect, vi, beforeEach } from "vitest";
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
    state: RunState.Todo,
    planVersion: 1,
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

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findActiveByIssueId: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn() };
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
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn(),
    resolveMainRepoPath: vi.fn(),
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
    logger,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("does nothing for issue.created", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("does nothing for issue.updated", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("delegates to handleCommand for comment.command when a command is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" },
    });

    expect(spy).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does not call handleCommand for comment.command when command is absent", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it.each(["ai-plan", "run-ai"] as const)("dispatches %s to startRun", async (type) => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan: approves and begins execution when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-5" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-5");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-5");
  });

  it("approve-plan: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan: rejects with the command body as linear-sourced feedback", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-5" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-5", "needs more detail", "linear");
  });

  it("reject-plan: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review: re-runs review when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-5" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-5");
  });

  it("re-review: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai: transitions the active run with BLOCKED from user-command", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-5", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const transitionSpy = vi
      .spyOn(svc as unknown as { transitionAndRecord: (...args: unknown[]) => Promise<Run> }, "transitionAndRecord")
      .mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(transitionSpy).toHaveBeenCalledWith(run, RunEvent.BLOCKED, "user-command");
  });

  it("pause-ai: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const transitionSpy = vi.spyOn(
      svc as unknown as { transitionAndRecord: (...args: unknown[]) => Promise<Run> },
      "transitionAndRecord",
    );

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it("resume-ai: transitions the active run with RESET_TO_TODO from user-command", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-5", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const transitionSpy = vi
      .spyOn(svc as unknown as { transitionAndRecord: (...args: unknown[]) => Promise<Run> }, "transitionAndRecord")
      .mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(transitionSpy).toHaveBeenCalledWith(run, RunEvent.RESET_TO_TODO, "user-command");
  });

  it("resume-ai: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const transitionSpy = vi.spyOn(
      svc as unknown as { transitionAndRecord: (...args: unknown[]) => Promise<Run> },
      "transitionAndRecord",
    );

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it("unknown: logs a warning and takes no action", async () => {
    const { deps, runRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "LIN-1", command: { type: "unknown", raw: "/bogus" } },
      "Unknown command received",
    );
  });
});
