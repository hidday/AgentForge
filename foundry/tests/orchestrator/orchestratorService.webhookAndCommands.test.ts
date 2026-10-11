import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
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
    resolveMainRepoPath: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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
    },
    runRepo,
    logger,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("does nothing (no throw) for 'issue.created' action", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    await expect(svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" })).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "issue.created", issueId: "LIN-1" }),
      "Handling Linear webhook",
    );
  });

  it("does nothing (no throw) for 'issue.updated' action", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    await expect(svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" })).resolves.toBeUndefined();
  });

  it("calls handleCommand for 'comment.command' when a command is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    const command: LinearCommand = { type: "ai-plan" };
    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does NOT call handleCommand for 'comment.command' when command is absent", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  let svc: OrchestratorService;
  let runRepo: ReturnType<typeof buildDeps>["runRepo"];
  let logger: ReturnType<typeof buildDeps>["logger"];

  beforeEach(() => {
    const built = buildDeps();
    svc = new OrchestratorService(built.deps as never);
    runRepo = built.runRepo;
    logger = built.logger;
  });

  it("'ai-plan' calls startRun with the issueId", async () => {
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());
    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("'run-ai' calls startRun with the issueId", async () => {
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());
    await svc.handleCommand("LIN-1", { type: "run-ai" });
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("'approve-plan' calls approvePlan then runExecution when an active run exists", async () => {
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-42");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-42");
  });

  it("'approve-plan' does nothing when there is no active run", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("'reject-plan' calls rejectPlan with the active run id, body and source 'linear'", async () => {
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs more detail", "linear");
  });

  it("'reject-plan' does nothing when there is no active run", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("'re-review' calls runReview with the active run id", async () => {
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-42");
  });

  it("'re-review' does nothing when there is no active run", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("'pause-ai' transitions the active run with BLOCKED from source 'user-command'", async () => {
    const run = makeRun({ id: "run-42", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
    const eventCall = (svc.getEventRepo().create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(eventCall).toMatchObject({ runId: "run-42", source: "user-command" });
  });

  it("'pause-ai' does nothing when there is no active run", async () => {
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    await svc.handleCommand("LIN-1", { type: "pause-ai" });
    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("'resume-ai' transitions the active run with RESET_TO_TODO from source 'user-command'", async () => {
    const run = makeRun({ id: "run-42", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
  });

  it("'unknown' logs a warning and does not throw", async () => {
    await expect(
      svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});
