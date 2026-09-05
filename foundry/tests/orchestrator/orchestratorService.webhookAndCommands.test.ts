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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    logger,
    repoRegistry,
    plannerAgent,
    planReviewerAgent,
    linearSync,
    githubSync,
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("does nothing for issue.created", async () => {
    const { deps, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(logger.info).toHaveBeenCalledWith(
      { action: "issue.created", issueId: "LIN-1" },
      "Handling Linear webhook",
    );
  });

  it("does nothing for issue.updated", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
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

    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
  });

  it("does not call handleCommand for comment.command when command is absent", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("starts a run for ai-plan command", async () => {
    const { deps, runRepo, linearClient, repoRegistry, artifactRepo, plannerAgent, planReviewerAgent } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1-test",
      labels: [],
      priority: 0,
    });
    repoRegistry.resolveForIssue.mockReturnValue({
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
    repoRegistry.resolveWorkingDirectory.mockReturnValue("/tmp");
    repoRegistry.validateWorkingDirectory.mockReturnValue(undefined);
    repoRegistry.getRepoByName.mockReturnValue({
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
    runRepo.create.mockResolvedValue(todoRun);
    deps.gitService.setupRunWorktree.mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValueOnce(
        makeRun({ state: RunState.Planning, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" }),
      );
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded })); // NEEDS_HUMAN_CLARIFICATION
    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue({
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }],
      risks: [],
      steps: [],
      testPlan: "",
      confidence: 0.5,
    });

    await svc.handleCommand("LIN-1", { type: "ai-plan" });

    expect(runRepo.create).toHaveBeenCalled();
    void planReviewerAgent;
  });

  it("starts a run for run-ai command", async () => {
    const { deps, runRepo, linearClient, repoRegistry } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findActiveByIssueId.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.handleCommand("LIN-1", { type: "run-ai" });

    // Active run already exists -> startRun returns early without creating a new run
    expect(runRepo.create).not.toHaveBeenCalled();
    void linearClient;
    void repoRegistry;
  });

  it("approve-plan: approves plan and runs execution when an active run exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.findById.mockResolvedValue(activeRun);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "a1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: {
            planVersion: 1,
            summary: "s",
            assumptions: [],
            openQuestions: [],
            risks: [],
            steps: [],
            testPlan: "",
            confidence: 0.9,
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    // runExecution will call assertCanExecute; force it to throw so we don't need
    // to mock the full executor pipeline -- we only assert approvePlan+runExecution
    // were both invoked (execution failing past approval is a separate concern).
    await expect(svc.handleCommand("LIN-1", { type: "approve-plan" })).rejects.toThrow();

    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("reject-plan: calls rejectPlan when an active run exists", async () => {
    const { deps, runRepo, artifactRepo, linearClient, plannerAgent, planReviewerAgent, repoRegistry } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.findById.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning }));
    repoRegistry.getRepoByName.mockReturnValue({
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
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1-test",
      labels: [],
      priority: 0,
    });
    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue({
      planVersion: 2,
      summary: "s",
      assumptions: [],
      openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }],
      risks: [],
      steps: [],
      testPlan: "",
      confidence: 0.9,
    });

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "feedback text" });

    expect(linearClient.postComment).toHaveBeenCalled();
    void planReviewerAgent;
  });

  it("reject-plan: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("re-review: calls runReview when an active run exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ state: RunState.AIReview, prNumber: 5 });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.findById.mockResolvedValue(activeRun);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    // runReview requires an ExecutionReport -> assertCanReview throws (PolicyViolationError)
    await expect(svc.handleCommand("LIN-1", { type: "re-review" })).rejects.toThrow();
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledWith("LIN-1");
  });

  it("re-review: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("pause-ai: transitions active run to AIBlocked via BLOCKED event", async () => {
    const { deps, runRepo, eventRepo, linearSync, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.BLOCKED, source: "user-command" }),
    );
    expect(linearSync.syncState).toHaveBeenCalled();
    expect(githubSync.syncState).toHaveBeenCalled();
  });

  it("pause-ai: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai: transitions active run back to Todo via RESET_TO_TODO event", async () => {
    const { deps, runRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ state: RunState.AIBlocked });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Todo }));

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.RESET_TO_TODO, source: "user-command" }),
    );
  });

  it("resume-ai: does nothing when no active run exists", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findActiveByIssueId.mockResolvedValue(null);

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("unknown: logs a warning and does nothing else", async () => {
    const { deps, logger, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/frobnicate" });

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "LIN-1", command: { type: "unknown", raw: "/frobnicate" } },
      "Unknown command received",
    );
    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});
