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
  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
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
    },
    runRepo,
    eventRepo,
    linearSync,
    githubSync,
    logger,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  let svc: OrchestratorService;
  let handleCommandSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const { deps } = buildDeps();
    svc = new OrchestratorService(deps as never);
    handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);
  });

  it("is a no-op for issue.created", async () => {
    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });
    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("delegates to handleCommand for comment.command when a command is present", async () => {
    const command = { type: "ai-plan" } as const;
    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });
    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does not call handleCommand for comment.command when command is absent", async () => {
    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });
    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("routes ai-plan to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("routes run-ai to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan: approves and runs execution when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun();
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith(run.id);
    expect(runExecutionSpy).toHaveBeenCalledWith(run.id);
  });

  it("approve-plan: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan: calls rejectPlan with the command body when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun();
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "not good" });

    expect(rejectPlanSpy).toHaveBeenCalledWith(run.id, "not good", "linear");
  });

  it("reject-plan: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "nope" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review: calls runReview when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun();
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith(run.id);
  });

  it("re-review: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai: transitions the active run to BLOCKED via user-command", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const run = makeRun({ state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith(run.id, RunState.AIBlocked);
    const eventCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(eventCall).toBeDefined();
    expect((eventCall![0] as { source: string }).source).toBe("user-command");
  });

  it("pause-ai: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai: transitions the active run via RESET_TO_TODO", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const run = makeRun({ state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith(run.id, RunState.Todo);
    const eventCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
    );
    expect(eventCall).toBeDefined();
  });

  it("resume-ai: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("unknown: logs a warning and takes no action", async () => {
    const { deps, runRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/frobnicate" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Unknown command"),
    );
    expect(warnCall).toBeDefined();
  });
});
