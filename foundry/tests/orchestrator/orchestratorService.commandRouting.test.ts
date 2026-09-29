import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearCommand } from "../../src/linear/linearCommandParser.js";
import type { WebhookPayload } from "../../src/orchestrator/orchestratorService.js";

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
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn() };
  const githubClient = { getPRDiff: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn() };
  const githubSync = { syncState: vi.fn(), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
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
    },
    runRepo,
    logger,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("comment.command with a command dispatches to handleCommand", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    const command: LinearCommand = { type: "approve-plan" };
    const payload: WebhookPayload = { action: "comment.command", issueId: "LIN-1", command };
    await svc.handleLinearWebhook(payload);

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("comment.command without a command does nothing", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("issue.created is a no-op", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await expect(
      svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("issue.updated is a no-op", async () => {
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
  it("ai-plan calls startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai calls startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan with an active run calls approvePlan then runExecution", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);

    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-42");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-42");
  });

  it("approve-plan with no active run does nothing", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan with an active run calls rejectPlan with the command body and 'linear' source", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);

    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs more detail", "linear");
  });

  it("reject-plan with no active run does nothing", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review with an active run calls runReview", async () => {
    const { deps, runRepo } = buildDeps();
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);

    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-42");
  });

  it("re-review with no active run does nothing", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai with an active run transitions via BLOCKED", async () => {
    const { deps, runRepo, logger } = buildDeps();
    const run = makeRun({ id: "run-42", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });

    const svc = new OrchestratorService(deps as never);
    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    const transitionLog = logger.info.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string) === "State transition",
    );
    expect(transitionLog).toBeDefined();
    expect((transitionLog![0] as { event: string }).event).toBe("BLOCKED");
  });

  it("resume-ai with an active run transitions via RESET_TO_TODO", async () => {
    const { deps, runRepo, logger } = buildDeps();
    const run = makeRun({ id: "run-42", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });

    const svc = new OrchestratorService(deps as never);
    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    const transitionLog = logger.info.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string) === "State transition",
    );
    expect(transitionLog).toBeDefined();
    expect((transitionLog![0] as { event: string }).event).toBe("RESET_TO_TODO");
  });

  it("pause-ai / resume-ai with no active run do nothing", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await svc.handleCommand("LIN-1", { type: "pause-ai" });
    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("unknown command logs a warning and does nothing else", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/whatever" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Unknown command received"),
    );
    expect(warnCall).toBeDefined();
  });
});
