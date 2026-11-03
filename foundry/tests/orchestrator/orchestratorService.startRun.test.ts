import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

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
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
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
    getRelatedContext: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
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
    githubClient,
    repoRegistry,
    gitService,
    logger,
    dashboardEmitter,
    plannerAgent,
    planReviewerAgent,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one or touching git", async () => {
    const { deps, runRepo, gitService, linearClient, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const existing = makeRun({ id: "run-existing", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ existingRunId: "run-existing" }),
      "Active run already exists for this issue, returning existing run",
    );
  });

  it("propagates an error from gitService.setupRunWorktree without creating further state", async () => {
    const { deps, runRepo, repoRegistry, linearClient, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
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
    runRepo.create.mockResolvedValue(makeRun({ state: RunState.Todo }));
    gitService.setupRunWorktree.mockRejectedValue(new Error("worktree creation failed"));

    await expect(svc.startRun("LIN-1")).rejects.toThrow("worktree creation failed");

    // The run row was created before the worktree failure, but no state transition
    // or planning work should have happened afterwards.
    expect(runRepo.create).toHaveBeenCalledTimes(1);
    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("propagates PolicyViolationError from repoRegistry.validateWorkingDirectory", async () => {
    const { deps, runRepo, repoRegistry, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
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
    repoRegistry.resolveWorkingDirectory.mockReturnValue("/not/allowed");
    repoRegistry.validateWorkingDirectory.mockImplementation(() => {
      throw new Error("working directory escapes repo root");
    });

    await expect(svc.startRun("LIN-1")).rejects.toThrow("working directory escapes repo root");
    expect(runRepo.create).not.toHaveBeenCalled();
  });

  it("happy path: creates run, sets up worktree, plans, and advances to PlanReview", async () => {
    const { deps, runRepo, repoRegistry, linearClient, gitService, artifactRepo, plannerAgent, planReviewerAgent, dashboardEmitter } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
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
    gitService.setupRunWorktree.mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1-test1234",
    });
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1-test1234" })
      .mockResolvedValueOnce(planningRun);

    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED -> Planning
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED -> PlanReview
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED -> AwaitingPlanApproval

    // requireRun inside runPlanReview looks the run up by id, which by then is PlanReview
    runRepo.findById.mockResolvedValue(planReviewRun);

    const plan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(plan);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "art-plan",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: plan,
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });

    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Looks solid",
      findings: [],
    });

    const result = await svc.startRun("LIN-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");
    expect(plannerAgent.run).toHaveBeenCalledTimes(1);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI planning started"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("buildTaskBundle: falls back to config defaultBranch when GitHub lookup fails, and omits relatedContext when fetch fails", async () => {
    const { deps, runRepo, repoRegistry, linearClient, gitService, artifactRepo, plannerAgent, planReviewerAgent, githubClient, logger } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });
    githubClient.getDefaultBranch.mockRejectedValue(new Error("github unreachable"));
    linearClient.getRelatedContext.mockRejectedValue(new Error("linear unreachable"));

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
    gitService.setupRunWorktree.mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1-test1234",
    });
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1-test1234" })
      .mockResolvedValueOnce(planningRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.findById.mockResolvedValue(planReviewRun);

    const plan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(plan);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "art-plan",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: plan,
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Looks solid",
      findings: [],
    });

    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Failed to fetch related Linear context; proceeding without it",
    );

    // The bundle passed to the planner should use the config default branch and
    // have no relatedContext field.
    const bundleArg = plannerAgent.run.mock.calls[0]?.[0];
    expect(bundleArg.repo.defaultBranch).toBe("main");
    expect(bundleArg.relatedContext).toBeUndefined();
  });

  it("buildTaskBundle: uses the remote default branch when it differs from config, and includes relatedContext when present", async () => {
    const { deps, runRepo, repoRegistry, linearClient, gitService, artifactRepo, plannerAgent, planReviewerAgent, githubClient, logger } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });
    githubClient.getDefaultBranch.mockResolvedValue("develop");
    linearClient.getRelatedContext.mockResolvedValue({
      parent: {
        id: "parent-1",
        title: "Parent issue",
        description: "Parent desc",
        state: "In Progress",
        labels: [],
        priority: 1,
      },
      blockers: [],
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
    gitService.setupRunWorktree.mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1-test1234",
    });
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1-test1234" })
      .mockResolvedValueOnce(planningRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.findById.mockResolvedValue(planReviewRun);

    const plan = makePlan({ planVersion: 1, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(plan);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "art-plan",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: plan,
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Looks solid",
      findings: [],
    });

    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );

    const bundleArg = plannerAgent.run.mock.calls[0]?.[0];
    expect(bundleArg.repo.defaultBranch).toBe("develop");
    expect(bundleArg.relatedContext).toEqual({
      parent: expect.objectContaining({ id: "parent-1" }),
      blockers: [],
    });
  });
});
