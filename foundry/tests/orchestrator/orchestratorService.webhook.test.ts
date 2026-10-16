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
    state: RunState.Planning,
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
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
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

    const command = { type: "ai-plan" as const };
    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledTimes(1);
    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does NOT call handleCommand when comment.command has no command payload", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created and issue.updated (no command dispatch)", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("routes 'ai-plan' to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("routes 'run-ai' to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  describe("approve-plan", () => {
    it("calls approvePlan then runExecution when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const activeRun = makeRun({ id: "run-active" });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(activeRun);
      const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).toHaveBeenCalledWith("run-active");
      expect(runExecutionSpy).toHaveBeenCalledWith("run-active");
      // Order matters: approvePlan before runExecution
      expect(approvePlanSpy.mock.invocationCallOrder[0]).toBeLessThan(
        runExecutionSpy.mock.invocationCallOrder[0],
      );
    });

    it("does nothing when no active run exists for the issue", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());
      const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).not.toHaveBeenCalled();
      expect(runExecutionSpy).not.toHaveBeenCalled();
    });
  });

  describe("reject-plan", () => {
    it("calls rejectPlan with the command body and source='linear' when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const activeRun = makeRun({ id: "run-active" });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs work" });

      expect(rejectPlanSpy).toHaveBeenCalledWith("run-active", "needs work", "linear");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" });

      expect(rejectPlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("re-review", () => {
    it("calls runReview when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const activeRun = makeRun({ id: "run-active" });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).toHaveBeenCalledWith("run-active");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause-ai", () => {
    it("transitions the active run to AIBlocked via BLOCKED, source='user-command'", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const activeRun = makeRun({ id: "run-active", state: RunState.Planning });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      runRepo.updateState.mockResolvedValue(makeRun({ id: "run-active", state: RunState.AIBlocked }));

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-active", RunState.AIBlocked);
      const call = eventRepo.create.mock.calls[0][0] as { eventType: string; source: string };
      expect(call.eventType).toBe(RunEvent.BLOCKED);
      expect(call.source).toBe("user-command");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("resume-ai", () => {
    it("transitions the active run back to Todo via RESET_TO_TODO, source='user-command'", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const activeRun = makeRun({ id: "run-active", state: RunState.AIBlocked });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      runRepo.updateState.mockResolvedValue(makeRun({ id: "run-active", state: RunState.Todo }));

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-active", RunState.Todo);
      const call = eventRepo.create.mock.calls[0][0] as { eventType: string; source: string };
      expect(call.eventType).toBe(RunEvent.RESET_TO_TODO);
      expect(call.source).toBe("user-command");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  it("logs a warning and does nothing for 'unknown' commands", async () => {
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
