import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
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
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
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
    getDefaultRepo: vi.fn().mockReturnValue({
      name: "default-repo",
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
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-retry" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main"),
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
    plannerAgent,
    planReviewerAgent,
    gitService,
    repoRegistry,
  };
}

describe("OrchestratorService.retryRun", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.retryRun("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("sets up a fresh worktree when the run has no branchName yet", async () => {
    const { deps, runRepo, gitService, repoRegistry, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo, branchName: null, repo: "test-repo" });
    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });

    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-retry" })
      .mockResolvedValueOnce(planningRun);

    const plan = makePlan({ openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    const result = await svc.retryRun("run-1");

    expect(repoRegistry.getRepoByName).toHaveBeenCalledWith("test-repo");
    expect(gitService.resolveMainRepoPath).toHaveBeenCalledWith(todoRun.workingDirectory);
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("falls back to repoRegistry.getDefaultRepo when getRepoByName returns nothing", async () => {
    const { deps, runRepo, repoRegistry, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    repoRegistry.getRepoByName.mockReturnValue(null);

    const todoRun = makeRun({ state: RunState.Todo, branchName: null });
    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });

    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-retry" })
      .mockResolvedValueOnce(planningRun);

    const plan = makePlan({ openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.retryRun("run-1");

    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });

  it("does NOT set up a worktree when the run already has a branchName", async () => {
    const { deps, runRepo, gitService, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo, branchName: "ai/already-set" });
    const planningRun = makeRun({ state: RunState.Planning, branchName: "ai/already-set" });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1, branchName: "ai/already-set" });
    const awaitingApprovalRun = makeRun({
      state: RunState.AwaitingPlanApproval,
      planVersion: 1,
      branchName: "ai/already-set",
    });

    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.update.mockResolvedValue(planningRun);

    const plan = makePlan({ openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the re-plan has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo, branchName: "ai/already-set" });
    const planningRun = makeRun({ state: RunState.Planning, branchName: "ai/already-set" });
    const planReviewRun = makeRun({ state: RunState.PlanReview, branchName: "ai/already-set" });
    const clarificationRun = makeRun({
      state: RunState.HumanClarificationNeeded,
      branchName: "ai/already-set",
    });

    runRepo.findById.mockResolvedValue(todoRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue(planningRun);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    const planWithBlocker = makePlan({
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(planWithBlocker);

    const result = await svc.retryRun("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
