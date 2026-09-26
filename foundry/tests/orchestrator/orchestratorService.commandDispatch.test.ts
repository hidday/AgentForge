import { describe, it, expect, vi, afterEach } from "vitest";
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
  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };
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
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches comment.command with a command to handleCommand", async () => {
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

  it("does not dispatch comment.command when no command is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("OrchestratorService.handleCommand -- dispatch to lifecycle methods", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ai-plan calls startRun with the issueId", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai calls startRun with the issueId", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan calls approvePlan then runExecution when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun();
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).toHaveBeenCalledWith("run-1");
    expect(execSpy).toHaveBeenCalledWith("run-1");
  });

  it("approve-plan is a no-op when there is no active run for the issue", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("reject-plan calls rejectPlan with the command body and source 'linear'", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun();
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

    expect(spy).toHaveBeenCalledWith("run-1", "needs more detail", "linear");
  });

  it("reject-plan is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("re-review calls runReview when an active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun();
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(spy).toHaveBeenCalledWith("run-1");
  });

  it("re-review is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("logs a warning for an unknown command and takes no further action", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand -- pause-ai / resume-ai state transitions", () => {
  it("pause-ai transitions an active run to AIBlocked via BLOCKED", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const run = makeRun({ state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.BLOCKED);
  });

  it("pause-ai is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai transitions a blocked run back to Todo via RESET_TO_TODO", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const run = makeRun({ state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Todo);
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.RESET_TO_TODO);
  });

  it("resume-ai is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.startRun -- existing active run short-circuit", () => {
  it("returns the existing active run without creating a new one or contacting Linear", async () => {
    const { deps, runRepo } = buildDeps();
    const existing = makeRun({ id: "run-existing", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(deps.linearClient.getIssue).not.toHaveBeenCalled();
    expect(runRepo.create).not.toHaveBeenCalled();
  });
});
