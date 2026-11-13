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
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) =>
      Promise.resolve(makeRun({ state })),
    ),
    update: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn(),
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
  it("no-ops on issue.created", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("no-ops on issue.updated", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("does nothing on comment.command when payload.command is absent", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("delegates to handleCommand when payload.command is present", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    const command = { type: "unknown" as const, raw: "/foo" };
    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
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

  describe("approve-plan", () => {
    it("calls approvePlan then runExecution when an active run exists", async () => {
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

    it("does nothing when no active run exists", async () => {
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

  describe("reject-plan", () => {
    it("calls rejectPlan with the command body and source 'linear' when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ id: "run-42" });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

      expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs more detail", "linear");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

      await svc.handleCommand("LIN-1", { type: "reject-plan" });

      expect(rejectPlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("re-review", () => {
    it("calls runReview when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ id: "run-42" });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).toHaveBeenCalledWith("run-42");
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const runReviewSpy = vi.spyOn(svc, "runReview");

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause-ai", () => {
    it("transitions the active run to AIBlocked via BLOCKED event", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ id: "run-42", state: RunState.Planning });
      runRepo.findActiveByIssueId.mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
      const eventCall = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
      );
      expect(eventCall).toBeDefined();
      expect((eventCall![0] as { source: string }).source).toBe("user-command");
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
    it("transitions the active run back to Todo via RESET_TO_TODO event", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const run = makeRun({ id: "run-42", state: RunState.AIBlocked });
      runRepo.findActiveByIssueId.mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
      const eventCall = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
      );
      expect(eventCall).toBeDefined();
    });

    it("does nothing when no active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  it("logs a warning and no-ops for an unknown command", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/foo" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Unknown command"),
    );
    expect(warnCall).toBeDefined();
  });
});
