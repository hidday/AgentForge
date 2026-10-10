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

function buildDeps(overrides: Record<string, unknown> = {}) {
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
  };

  const githubClient = { getPRDiff: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    logger,
  };
}

describe("OrchestratorService getters", () => {
  it("exposes the injected collaborators via their getters", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(deps.runRepo);
    expect(svc.getArtifactRepo()).toBe(deps.artifactRepo);
    expect(svc.getEventRepo()).toBe(deps.eventRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
    // agentSkillRepo is optional and was not injected here.
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });

  it("getAgentSkillRepo returns the injected repo when provided", () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const { deps } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("is a no-op for issue.created", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(deps.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(deps.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("dispatches to handleCommand for comment.command when a command is present", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "pause-ai" },
    });

    // handleCommand's pause-ai branch looks up the active run for the issue.
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
  });

  it("does nothing for comment.command when no command is present on the payload", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("unknown command type logs a warning and does nothing else", async () => {
    const { deps, runRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "string" && (call[1] as string).includes("Unknown command"),
    );
    expect(warnCall).toBeDefined();
  });

  describe("approve-plan", () => {
    it("approves the plan and triggers execution when an active run exists", async () => {
      const { deps, runRepo, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const approveSpy = vi
        .spyOn(svc, "approvePlan")
        .mockResolvedValue(makeRun({ state: RunState.Implementing }));
      const execSpy = vi
        .spyOn(svc, "runExecution")
        .mockResolvedValue(makeRun({ state: RunState.AIReview }));

      runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-42" }));

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approveSpy).toHaveBeenCalledWith("run-42");
      expect(execSpy).toHaveBeenCalledWith("run-42");
      expect(artifactRepo.findLatestByType).not.toHaveBeenCalled(); // sanity: no stray calls
    });

    it("does nothing when no active run exists for the issue", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const approveSpy = vi.spyOn(svc, "approvePlan");
      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approveSpy).not.toHaveBeenCalled();
    });
  });

  describe("reject-plan", () => {
    it("rejects the plan with the command body when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const rejectSpy = vi
        .spyOn(svc, "rejectPlan")
        .mockResolvedValue(makeRun({ state: RunState.Planning }));

      runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-77" }));

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs OAuth" });

      expect(rejectSpy).toHaveBeenCalledWith("run-77", "needs OAuth", "linear");
    });

    it("does nothing when no active run exists for the issue", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const rejectSpy = vi.spyOn(svc, "rejectPlan");

      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "reject-plan" });

      expect(rejectSpy).not.toHaveBeenCalled();
    });
  });

  describe("re-review", () => {
    it("triggers runReview when an active run exists", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const reviewSpy = vi
        .spyOn(svc, "runReview")
        .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

      runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ id: "run-99" }));

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(reviewSpy).toHaveBeenCalledWith("run-99");
    });

    it("does nothing when no active run exists for the issue", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const reviewSpy = vi.spyOn(svc, "runReview");

      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(reviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause-ai", () => {
    it("transitions the active run to AIBlocked via BLOCKED event", async () => {
      const { deps, runRepo, eventRepo, linearSync, githubSync } = buildDeps() as unknown as {
        deps: Record<string, unknown>;
        runRepo: ReturnType<typeof buildDeps>["runRepo"];
        eventRepo: ReturnType<typeof buildDeps>["eventRepo"];
        linearSync: { syncState: ReturnType<typeof vi.fn> };
        githubSync: { syncState: ReturnType<typeof vi.fn> };
      };
      const svc = new OrchestratorService(deps as never);

      const activeRun = makeRun({ id: "run-5", state: RunState.Implementing });
      runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
      runRepo.updateState.mockResolvedValue(makeRun({ id: "run-5", state: RunState.AIBlocked }));

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-5", RunState.AIBlocked);
      const eventTypes = eventRepo.create.mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain(RunEvent.BLOCKED);
    });

    it("does nothing when no active run exists for the issue", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("resume-ai", () => {
    it("transitions a blocked run back to Todo via RESET_TO_TODO event", async () => {
      const { deps, runRepo, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const blockedRun = makeRun({ id: "run-6", state: RunState.AIBlocked });
      runRepo.findActiveByIssueId.mockResolvedValue(blockedRun);
      runRepo.updateState.mockResolvedValue(makeRun({ id: "run-6", state: RunState.Todo }));

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith("run-6", RunState.Todo);
      const eventTypes = eventRepo.create.mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain(RunEvent.RESET_TO_TODO);
    });

    it("does nothing when no active run exists for the issue", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      runRepo.findActiveByIssueId.mockResolvedValue(null);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("ai-plan / run-ai", () => {
    it("ai-plan triggers startRun", async () => {
      const { deps } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const startSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "ai-plan" });

      expect(startSpy).toHaveBeenCalledWith("LIN-1");
    });

    it("run-ai triggers startRun", async () => {
      const { deps } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      const startSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "run-ai" });

      expect(startSpy).toHaveBeenCalledWith("LIN-1");
    });
  });
});
