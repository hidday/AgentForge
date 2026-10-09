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
    create: vi.fn(),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
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

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn(),
  };

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
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test1234" }),
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
    githubClient,
    repoRegistry,
    gitService,
    logger,
    dashboardEmitter,
    plannerAgent,
  };
}

describe("OrchestratorService -- simple accessor getters", () => {
  it("getRunRepo/getArtifactRepo/getEventRepo/getAgentSkillRepo/getLinearClient return the injected collaborators", () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const built = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);

    expect(svc.getRunRepo()).toBe(built.runRepo);
    expect(svc.getArtifactRepo()).toBe(built.artifactRepo);
    expect(svc.getEventRepo()).toBe(built.eventRepo);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
    expect(svc.getLinearClient()).toBe(built.linearClient);
  });

  it("getAgentSkillRepo returns undefined when no agentSkillRepo dep was supplied", () => {
    const built = buildDeps();
    const svc = new OrchestratorService(built.deps as never);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("issue.created action is a no-op", async () => {
    const built = buildDeps();
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("issue.updated action is a no-op", async () => {
    const built = buildDeps();
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("comment.command with a command dispatches to handleCommand", async () => {
    const built = buildDeps();
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);
    const command: LinearCommand = { type: "unknown" };

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1", command });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", command);
  });

  it("comment.command without a command does NOT dispatch to handleCommand", async () => {
    const built = buildDeps();
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand");

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  let svc: OrchestratorService;
  let built: ReturnType<typeof buildDeps>;

  beforeEach(() => {
    built = buildDeps();
    svc = new OrchestratorService(built.deps as never);
  });

  it("ai-plan dispatches to startRun", async () => {
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());
    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("run-ai dispatches to startRun", async () => {
    const spy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());
    await svc.handleCommand("LIN-1", { type: "run-ai" });
    expect(spy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan: when an active run exists, calls approvePlan then runExecution", async () => {
    const run = makeRun();
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
    const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).toHaveBeenCalledWith(run.id);
    expect(execSpy).toHaveBeenCalledWith(run.id);
  });

  it("approve-plan: when no active run exists, does nothing", async () => {
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const approveSpy = vi.spyOn(svc, "approvePlan");

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("reject-plan: when an active run exists, calls rejectPlan with the command body and source 'linear'", async () => {
    const run = makeRun();
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const rejectSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs rework" });

    expect(rejectSpy).toHaveBeenCalledWith(run.id, "needs rework", "linear");
  });

  it("reject-plan: when no active run exists, does nothing", async () => {
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const rejectSpy = vi.spyOn(svc, "rejectPlan");

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" });

    expect(rejectSpy).not.toHaveBeenCalled();
  });

  it("re-review: when an active run exists, calls runReview", async () => {
    const run = makeRun();
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(reviewSpy).toHaveBeenCalledWith(run.id);
  });

  it("re-review: when no active run exists, does nothing", async () => {
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const reviewSpy = vi.spyOn(svc, "runReview");

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai: when an active run exists, transitions it via BLOCKED with source 'user-command'", async () => {
    const run = makeRun({ state: RunState.Implementing });
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    built.runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(built.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, eventType: RunEvent.BLOCKED, source: "user-command" }),
    );
    expect(built.runRepo.updateState).toHaveBeenCalledWith(run.id, RunState.AIBlocked);
  });

  it("pause-ai: when no active run exists, does nothing", async () => {
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(built.eventRepo.create).not.toHaveBeenCalled();
  });

  it("resume-ai: when an active run exists, transitions it via RESET_TO_TODO with source 'user-command'", async () => {
    const run = makeRun({ state: RunState.AIBlocked });
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);
    built.runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Todo });

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(built.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        eventType: RunEvent.RESET_TO_TODO,
        source: "user-command",
      }),
    );
    expect(built.runRepo.updateState).toHaveBeenCalledWith(run.id, RunState.Todo);
  });

  it("resume-ai: when no active run exists, does nothing", async () => {
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(built.runRepo.updateState).not.toHaveBeenCalled();
  });

  it("unknown command logs a warning and does nothing else", async () => {
    await svc.handleCommand("LIN-1", { type: "unknown" });

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});

describe("OrchestratorService.startRun -- active run short-circuit", () => {
  it("returns the existing active run without creating a new one when one is already active", async () => {
    const built = buildDeps();
    const svc = new OrchestratorService(built.deps as never);
    const activeRun = makeRun({ id: "run-existing", state: RunState.Implementing });
    built.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(activeRun);
    expect(built.runRepo.create).not.toHaveBeenCalled();
    expect(built.linearClient.getIssue).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.buildTaskBundle -- default branch resolution", () => {
  it("prefers the GitHub remote default branch over the configured value when they differ", async () => {
    const built = buildDeps();
    const svc = new OrchestratorService(built.deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    built.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Test issue",
      description: "desc",
      url: "https://linear.app/x",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });
    built.repoRegistry.resolveForIssue.mockReturnValue({
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
    });
    built.repoRegistry.resolveWorkingDirectory.mockReturnValue("/tmp/repo");
    built.repoRegistry.getRepoByName.mockReturnValue({
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
    });
    built.githubClient.getDefaultBranch.mockResolvedValue("trunk");
    built.runRepo.create.mockResolvedValue(run);
    // Track state across update()/updateState() calls so the real state
    // machine transitions (invoked internally by startRun) see a consistent
    // run.state rather than a stale snapshot.
    let trackedState = run.state;
    built.runRepo.update.mockImplementation((_id: string, patch: Partial<Run>) =>
      Promise.resolve({ ...run, ...patch, state: trackedState }),
    );
    built.runRepo.updateState.mockImplementation((_id: string, newState: RunState) => {
      trackedState = newState;
      return Promise.resolve({ ...run, state: newState });
    });
    built.plannerAgent.run.mockResolvedValue({
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [],
      testPlan: "t",
      confidence: 0.9,
    });

    // Stub out the next stage so this test stays scoped to buildTaskBundle.
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(run);

    await svc.startRun("LIN-1");

    expect(built.githubClient.getDefaultBranch).toHaveBeenCalledWith("test-repo");
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    const bundleArg = built.plannerAgent.run.mock.calls[0]?.[0] as { repo: { defaultBranch: string } };
    expect(bundleArg.repo.defaultBranch).toBe("trunk");
    runPlanReviewSpy.mockRestore();
  });
});
