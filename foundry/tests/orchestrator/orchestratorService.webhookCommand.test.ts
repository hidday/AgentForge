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
    state: RunState.Implementing,
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
    getRelatedContext: vi.fn(),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

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
    linearSync,
    githubSync,
    logger,
  };
}

describe("OrchestratorService accessor methods", () => {
  it("expose the underlying repositories and clients they were constructed with", () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildDeps({
      agentSkillRepo: { findTopKByRelevance: vi.fn(), incrementSuccess: vi.fn(), incrementFailure: vi.fn(), archiveIfLowUtility: vi.fn() },
    });
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    expect(svc.getAgentSkillRepo()).toBe(deps.agentSkillRepo);
  });

  it("getAgentSkillRepo returns undefined when the dependency was not supplied", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command with a command to handleCommand", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does NOT call handleCommand for comment.command with no command payload", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.updated", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(spy).not.toHaveBeenCalled();
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("is a no-op for an unrecognised action (falls through the switch harmlessly)", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await expect(
      svc.handleLinearWebhook({ action: "something.else", issueId: "LIN-1" }),
    ).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("dispatches ai-plan to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("dispatches run-ai to startRun", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan: with an active run, calls approvePlan then runExecution with the run id", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(activeRun);
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).toHaveBeenCalledWith("run-42");
    expect(execSpy).toHaveBeenCalledWith("run-42");
    // approvePlan must be awaited before runExecution starts (ordering matters:
    // execution should never start on an unapproved plan).
    expect(approveSpy.mock.invocationCallOrder[0]).toBeLessThan(
      execSpy.mock.invocationCallOrder[0],
    );
  });

  it("approve-plan: with no active run, calls neither approvePlan nor runExecution", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("reject-plan: with an active run, calls rejectPlan with the run id, body, and 'linear' source", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const rejectSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs work" });

    expect(rejectSpy).toHaveBeenCalledWith("run-42", "needs work", "linear");
  });

  it("reject-plan: with no active run, does not call rejectPlan", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const rejectSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan" });

    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it("re-review: with an active run, calls runReview with the run id", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-42" });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(activeRun);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(reviewSpy).toHaveBeenCalledWith("run-42");
  });

  it("re-review: with no active run, does not call runReview", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai: with an active run, transitions via BLOCKED with source 'user-command'", async () => {
    const { deps, runRepo, eventRepo, linearSync, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-42", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-42", state: RunState.AIBlocked }));

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.AIBlocked);
    const call = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(call).toBeDefined();
    expect((call![0] as { source: string }).source).toBe("user-command");
    expect(linearSync.syncState).toHaveBeenCalled();
    expect(githubSync.syncState).toHaveBeenCalled();
  });

  it("pause-ai: with no active run, does not attempt a transition", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai: with an active run, transitions via RESET_TO_TODO with source 'user-command'", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const activeRun = makeRun({ id: "run-42", state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-42", state: RunState.Todo }));

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).toHaveBeenCalledWith("run-42", RunState.Todo);
    const call = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
    );
    expect(call).toBeDefined();
    expect((call![0] as { source: string }).source).toBe("user-command");
  });

  it("resume-ai: with no active run, does not attempt a transition", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("unknown: logs a warning and performs no repository dispatch", async () => {
    const { deps, runRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});
