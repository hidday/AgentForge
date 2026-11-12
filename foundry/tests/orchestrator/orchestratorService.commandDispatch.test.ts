import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
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
  };

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
    linearClient,
    logger,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command with a command to handleCommand", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    const command: LinearCommand = { type: "ai-plan" };
    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does NOT call handleCommand for comment.command when no command payload is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await expect(
      svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();

    expect(handleCommandSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
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

  it("is a no-op for an unrecognised action (falls through the switch silently)", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "some.other.action", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan dispatches to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai dispatches to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan looks up the active run, approves the plan, and runs execution", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-42");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-42");
  });

  it("approve-plan is a no-op when there is no active run for the issue", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
    expect(runExecutionSpy).not.toHaveBeenCalled();
  });

  it("reject-plan looks up the active run and rejects the plan with the command body", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs OAuth2" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs OAuth2", "linear");
  });

  it("reject-plan is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review looks up the active run and triggers runReview", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-42");
  });

  it("re-review is a no-op when there is no active run", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai looks up the active run and records a BLOCKED transition from user-command", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-42", state: RunState.AIBlocked }));
    runRepo.findById.mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string; source: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.BLOCKED);
    const blockedCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect((blockedCall![0] as { source: string }).source).toBe("user-command");
  });

  it("pause-ai is a no-op when there is no active run", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(eventRepo.create).not.toHaveBeenCalled();
  });

  it("resume-ai looks up the active run and records a RESET_TO_TODO transition from user-command", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ id: "run-42", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-42", state: RunState.Todo }));
    runRepo.findById.mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    const resetCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
    );
    expect(resetCall).toBeDefined();
    expect((resetCall![0] as { source: string }).source).toBe("user-command");
  });

  it("logs a warning and takes no action for an unknown command", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/not-a-real-command" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Unknown command received"),
    );
    expect(warnCall).toBeDefined();
  });
});

describe("OrchestratorService.startRun -- active run short-circuit", () => {
  it("returns the existing active run without creating a new one or calling the planner", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-existing", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(activeRun);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(deps.plannerAgent.run).not.toHaveBeenCalled();
    expect(deps.linearClient.getIssue).not.toHaveBeenCalled();
  });
});
