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
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
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
    linearClient,
    logger,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("no-ops on issue.created", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "issue.created" }),
      "Handling Linear webhook",
    );
  });

  it("no-ops on issue.updated", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    await expect(
      svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
  });

  it("dispatches to handleCommand on comment.command when a command is present", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "reject-plan", body: undefined },
    });

    // reject-plan with no active run should look up active run but not throw
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
  });

  it("does nothing on comment.command when command is absent", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan triggers startRun", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("run-ai triggers startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan calls approvePlan then runExecution when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-5" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-5");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-5");
  });

  it("approve-plan is a no-op when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan calls rejectPlan with the command body and source linear when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-5" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs work" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-5", "needs work", "linear");
  });

  it("reject-plan is a no-op when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review calls runReview when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-5" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-5");
  });

  it("re-review is a no-op when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai transitions the active run via BLOCKED event", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-5", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.BLOCKED);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-5", RunState.AIBlocked);
  });

  it("pause-ai is a no-op when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai transitions the active run via RESET_TO_TODO event", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-5", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.RESET_TO_TODO);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-5", RunState.Todo);
  });

  it("resume-ai is a no-op when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("logs a warning and does nothing for an unknown command", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});
