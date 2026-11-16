import { describe, it, expect, vi, beforeEach } from "vitest";
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

/**
 * A minimal OrchestratorService whose instance methods invoked by
 * handleCommand (startRun, approvePlan, runExecution, rejectPlan, runReview)
 * are stubbed directly on the instance. This isolates handleCommand's own
 * dispatch/branching logic from those methods' internals (covered by their
 * own dedicated test files).
 */
function buildService() {
  const runRepo = {
    findActiveByIssueId: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    update: vi.fn(),
    updateState: vi.fn().mockResolvedValue(makeRun()),
  };
  const artifactRepo = { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const linearClient = { getIssue: vi.fn(), postComment: vi.fn(), getRelatedContext: vi.fn() };
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
    postExecutionReportUpdate: vi.fn(),
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

  const svc = new OrchestratorService({
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
  } as never);

  return { svc, runRepo, eventRepo, logger };
}

describe("OrchestratorService.handleCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches ai-plan to startRun", async () => {
    const { svc } = buildService();
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" } as LinearCommand);

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("dispatches run-ai to startRun", async () => {
    const { svc } = buildService();
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" } as LinearCommand);

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  describe("approve-plan", () => {
    it("calls approvePlan then runExecution when an active run exists", async () => {
      const { svc, runRepo } = buildService();
      const activeRun = makeRun({ id: "run-42" });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(activeRun);
      const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "approve-plan" } as LinearCommand);

      expect(approvePlanSpy).toHaveBeenCalledWith("run-42");
      expect(runExecutionSpy).toHaveBeenCalledWith("run-42");
    });

    it("does nothing when no active run exists for the issue", async () => {
      const { svc, runRepo } = buildService();
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan");

      await svc.handleCommand("LIN-1", { type: "approve-plan" } as LinearCommand);

      expect(approvePlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("reject-plan", () => {
    it("calls rejectPlan with the command body and source 'linear' when an active run exists", async () => {
      const { svc, runRepo } = buildService();
      const activeRun = makeRun({ id: "run-42" });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", {
        type: "reject-plan",
        body: "needs OAuth2",
      } as LinearCommand);

      expect(rejectPlanSpy).toHaveBeenCalledWith("run-42", "needs OAuth2", "linear");
    });

    it("does nothing when no active run exists", async () => {
      const { svc, runRepo } = buildService();
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan");

      await svc.handleCommand("LIN-1", { type: "reject-plan" } as LinearCommand);

      expect(rejectPlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("re-review", () => {
    it("calls runReview when an active run exists", async () => {
      const { svc, runRepo } = buildService();
      const activeRun = makeRun({ id: "run-42" });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "re-review" } as LinearCommand);

      expect(runReviewSpy).toHaveBeenCalledWith("run-42");
    });

    it("does nothing when no active run exists", async () => {
      const { svc, runRepo } = buildService();
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const runReviewSpy = vi.spyOn(svc, "runReview");

      await svc.handleCommand("LIN-1", { type: "re-review" } as LinearCommand);

      expect(runReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause-ai", () => {
    it("transitions the active run via BLOCKED with source 'user-command'", async () => {
      const { svc, runRepo, eventRepo } = buildService();
      const activeRun = makeRun({ id: "run-42", state: RunState.Implementing });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

      await svc.handleCommand("LIN-1", { type: "pause-ai" } as LinearCommand);

      expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
      const eventCall = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
      );
      expect(eventCall).toBeDefined();
      expect((eventCall![0] as { source: string }).source).toBe("user-command");
    });

    it("does nothing when no active run exists", async () => {
      const { svc, runRepo } = buildService();
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "pause-ai" } as LinearCommand);

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("resume-ai", () => {
    it("transitions the active run via RESET_TO_TODO with source 'user-command'", async () => {
      const { svc, runRepo, eventRepo } = buildService();
      const activeRun = makeRun({ id: "run-42", state: RunState.AIBlocked });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Todo }));

      await svc.handleCommand("LIN-1", { type: "resume-ai" } as LinearCommand);

      expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
      const eventCall = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
      );
      expect(eventCall).toBeDefined();
      expect((eventCall![0] as { source: string }).source).toBe("user-command");
    });

    it("does nothing when no active run exists", async () => {
      const { svc, runRepo } = buildService();
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "resume-ai" } as LinearCommand);

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  it("logs a warning and does nothing for an unknown command", async () => {
    const { svc, logger, runRepo } = buildService();

    await svc.handleCommand("LIN-1", { type: "unknown" } as LinearCommand);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls handleCommand when action is comment.command and a command is present", async () => {
    const { svc } = buildService();
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);
    const command = { type: "ai-plan" } as LinearCommand;

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("does NOT call handleCommand when action is comment.command but no command is present", async () => {
    const { svc } = buildService();
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created", async () => {
    const { svc } = buildService();
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const { svc } = buildService();
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});
