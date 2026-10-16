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

function makePlanArtifact(plan: Plan): Artifact {
  return {
    id: "artifact-plan-1",
    runId: "run-1",
    type: "Plan",
    version: plan.planVersion,
    payloadJson: plan,
    rawText: "{}",
    createdAt: new Date(),
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
      title: "Test",
      description: "Test",
      branchName: "hidday/lin-1-test",
      labels: [],
      priority: 0,
    }),
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
    setupRunWorktree: vi.fn().mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-test1234",
    }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
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
    plannerAgent,
    planReviewerAgent,
    gitService,
  };
}

describe("OrchestratorService.retryRun", () => {
  it("sets up a fresh worktree when run.branchName is missing", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent, gitService } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo, branchName: null });
    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan({ openQuestions: [] });

    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED -> Planning
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED -> PlanReview
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED -> AwaitingPlanApproval
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-test1234" })
      .mockResolvedValueOnce(planningRun);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makePlanArtifact(plan));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.retryRun("run-1");

    expect(gitService.resolveMainRepoPath).toHaveBeenCalledWith(todoRun.workingDirectory);
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      todoRun.id,
      "main",
      "hidday/lin-1-test",
    );
    expect(runRepo.update).toHaveBeenNthCalledWith(1, todoRun.id, {
      workingDirectory: "/tmp/worktree",
      branchName: "ai/run-test1234",
    });
  });

  it("skips worktree setup when run.branchName is already set", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent, gitService } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan({ openQuestions: [] });

    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.update.mockResolvedValue(planningRun);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makePlanArtifact(plan));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(gitService.resolveMainRepoPath).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan has blocking open questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch" });
    const planningRun = makeRun({ state: RunState.Planning });
    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const planWithBlocker = makePlan({
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });

    runRepo.findById.mockResolvedValue(todoRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED -> Planning
      .mockResolvedValueOnce(planningRun) // PLAN_CREATED (stays logically, mocked same run)
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue(planningRun);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makePlanArtifact(planWithBlocker));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(planWithBlocker);

    const result = await svc.retryRun("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
