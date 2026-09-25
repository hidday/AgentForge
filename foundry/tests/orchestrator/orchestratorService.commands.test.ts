import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService, type WebhookPayload } from "../../src/orchestrator/orchestratorService.js";
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
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    dashboardEmitter,
    linearSync,
    githubSync,
    gitService,
  };
}

describe("OrchestratorService.handleCommand", () => {
  it("routes 'ai-plan' to startRun with the issue id", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("routes 'run-ai' to startRun with the issue id", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  describe("'approve-plan'", () => {
    it("approves the plan then runs execution when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ id: "run-42" });
      runRepo.findActiveByIssueId.mockResolvedValue(run);

      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
      const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
      expect(approvePlanSpy).toHaveBeenCalledWith("run-42");
      expect(runExecutionSpy).toHaveBeenCalledWith("run-42");
    });

    it("does nothing when there is no active run for the issue", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const approvePlanSpy = vi.spyOn(svc, "approvePlan");
      const runExecutionSpy = vi.spyOn(svc, "runExecution");

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).not.toHaveBeenCalled();
      expect(runExecutionSpy).not.toHaveBeenCalled();
    });
  });

  describe("'reject-plan'", () => {
    it("rejects the plan with the command body and source 'linear' when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ id: "run-42" });
      runRepo.findActiveByIssueId.mockResolvedValue(run);

      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

      const command: LinearCommand = { type: "reject-plan", body: "needs more detail" };
      await svc.handleCommand("LIN-1", command);

      expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs more detail", "linear");
    });

    it("does nothing when there is no active run for the issue", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

      await svc.handleCommand("LIN-1", { type: "reject-plan" });

      expect(rejectPlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("'re-review'", () => {
    it("triggers a code review when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ id: "run-42" });
      runRepo.findActiveByIssueId.mockResolvedValue(run);

      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).toHaveBeenCalledWith("run-42");
    });

    it("does nothing when there is no active run for the issue", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const runReviewSpy = vi.spyOn(svc, "runReview");

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("'pause-ai'", () => {
    it("transitions the active run to AIBlocked via BLOCKED event", async () => {
      const { deps, runRepo, eventRepo, linearSync, githubSync } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ id: "run-42", state: RunState.Todo });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const blockedRun = makeRun({ id: "run-42", state: RunState.AIBlocked });
      runRepo.updateState.mockResolvedValue(blockedRun);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-42",
          eventType: RunEvent.BLOCKED,
          source: "user-command",
          payloadJson: { from: RunState.Todo, to: RunState.AIBlocked },
        }),
      );
      expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
      expect(linearSync.syncState).toHaveBeenCalledWith(blockedRun);
      expect(githubSync.syncState).toHaveBeenCalledWith(blockedRun);
    });

    it("does nothing when there is no active run for the issue", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(eventRepo.create).not.toHaveBeenCalled();
      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("'resume-ai'", () => {
    it("transitions the active run back to Todo via RESET_TO_TODO event", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ id: "run-42", state: RunState.AIBlocked });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const todoRun = makeRun({ id: "run-42", state: RunState.Todo });
      runRepo.updateState.mockResolvedValue(todoRun);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-42",
          eventType: RunEvent.RESET_TO_TODO,
          source: "user-command",
        }),
      );
      expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
    });

    it("does nothing when there is no active run for the issue", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(eventRepo.create).not.toHaveBeenCalled();
    });
  });

  it("logs a warning and takes no action for 'unknown' commands", async () => {
    const { deps, runRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[1] === "string" && (call[1] as string).includes("Unknown command"),
    );
    expect(warnCall).toBeDefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op for 'issue.created'", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const payload: WebhookPayload = { action: "issue.created", issueId: "LIN-1" };
    await svc.handleLinearWebhook(payload);

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("is a no-op for 'issue.updated'", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const payload: WebhookPayload = { action: "issue.updated", issueId: "LIN-1" };
    await svc.handleLinearWebhook(payload);

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("is a no-op for an unrecognized action", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const payload = { action: "issue.deleted", issueId: "LIN-1" } as unknown as WebhookPayload;
    await svc.handleLinearWebhook(payload);

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("delegates to handleCommand for 'comment.command' when a command is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    const command: LinearCommand = { type: "ai-plan" };
    const payload: WebhookPayload = { action: "comment.command", issueId: "LIN-1", command };
    await svc.handleLinearWebhook(payload);

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does not call handleCommand for 'comment.command' when no command is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    const payload: WebhookPayload = { action: "comment.command", issueId: "LIN-1" };
    await svc.handleLinearWebhook(payload);

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});
