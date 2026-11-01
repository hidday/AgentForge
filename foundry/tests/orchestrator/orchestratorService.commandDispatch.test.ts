import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunEvent } from "../../src/domain/runEvent.js";
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

function buildMinimalDeps() {
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
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn(), getRelatedContext: vi.fn() };
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
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return {
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
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches to handleCommand for a comment.command action with a command present", async () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" },
    });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does not dispatch for a comment.command action with no command attached", async () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created", async () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for an unrecognized webhook action", async () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "something.else", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan starts a new run", async () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai starts a new run (alias of ai-plan)", async () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan approves the active run's plan and then kicks off execution", async () => {
    const deps = buildMinimalDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-42" }));
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-42");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-42");
  });

  it("approve-plan is a no-op when there is no active run for the issue", async () => {
    const deps = buildMinimalDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan forwards the comment body as feedback with source='linear'", async () => {
    const deps = buildMinimalDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-42" }));
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs more detail", "linear");
  });

  it("reject-plan is a no-op when there is no active run for the issue", async () => {
    const deps = buildMinimalDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review triggers runReview on the active run", async () => {
    const deps = buildMinimalDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-42" }));
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-42");
  });

  it("re-review is a no-op when there is no active run", async () => {
    const deps = buildMinimalDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai transitions the active run via BLOCKED with source 'user-command'", async () => {
    const deps = buildMinimalDeps();
    const activeRun = makeRun({ id: "run-42" });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const svc = new OrchestratorService(deps as never);
    const transitionSpy = vi
      .spyOn(svc as unknown as { transitionAndRecord: (...a: unknown[]) => Promise<Run> }, "transitionAndRecord")
      .mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(transitionSpy).toHaveBeenCalledWith(activeRun, RunEvent.BLOCKED, "user-command");
  });

  it("resume-ai transitions the active run via RESET_TO_TODO with source 'user-command'", async () => {
    const deps = buildMinimalDeps();
    const activeRun = makeRun({ id: "run-42" });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const svc = new OrchestratorService(deps as never);
    const transitionSpy = vi
      .spyOn(svc as unknown as { transitionAndRecord: (...a: unknown[]) => Promise<Run> }, "transitionAndRecord")
      .mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(transitionSpy).toHaveBeenCalledWith(activeRun, RunEvent.RESET_TO_TODO, "user-command");
  });

  it("pause-ai/resume-ai are no-ops when there is no active run", async () => {
    const deps = buildMinimalDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    const transitionSpy = vi
      .spyOn(svc as unknown as { transitionAndRecord: (...a: unknown[]) => Promise<Run> }, "transitionAndRecord")
      .mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "pause-ai" });
    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(transitionSpy).not.toHaveBeenCalled();
  });

  it("logs a warning and does nothing for an unknown command", async () => {
    const deps = buildMinimalDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { issueId: "LIN-1", command: { type: "unknown", raw: "/bogus" } },
      "Unknown command received",
    );
  });
});
