import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/issue/LIN-1",
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
  const createdRun = makeRun({ state: RunState.Todo });
  const runAfterWorktree = makeRun({
    state: RunState.Todo,
    branchName: "ai/run-1",
    workingDirectory: "/tmp/worktree",
  });
  const runAfterRequested = makeRun({
    state: RunState.Planning,
    branchName: "ai/run-1",
    workingDirectory: "/tmp/worktree",
  });
  const runAfterPlanCreated = makeRun({
    state: RunState.PlanReview,
    branchName: "ai/run-1",
    workingDirectory: "/tmp/worktree",
  });
  const runAfterPlanReviewApproved = makeRun({
    state: RunState.AwaitingPlanApproval,
    branchName: "ai/run-1",
    workingDirectory: "/tmp/worktree",
  });
  // Reflects the run after the RUN_REQUESTED transition (state: Planning) plus
  // the planVersion/plannerRuntime fields written post-plannerAgent.run().
  const runAfterPlannerUpdate = makeRun({
    state: RunState.Planning,
    branchName: "ai/run-1",
    workingDirectory: "/tmp/worktree",
    plannerRuntime: "claude-code",
  });

  const plan = makePlan();
  const planArtifact = makeArtifact({ type: "Plan", version: 1, payloadJson: plan });

  const runRepo = {
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(runAfterPlanCreated),
    findAll: vi.fn(),
    findByIssueId: vi.fn(),
    create: vi.fn().mockResolvedValue(createdRun),
    update: vi
      .fn()
      .mockResolvedValueOnce(runAfterWorktree) // after setupRunWorktree
      .mockResolvedValueOnce(runAfterPlannerUpdate), // after plannerAgent.run
    updateState: vi
      .fn()
      .mockResolvedValueOnce(runAfterRequested) // RUN_REQUESTED
      .mockResolvedValueOnce(runAfterPlanCreated) // PLAN_CREATED
      .mockResolvedValueOnce(runAfterPlanReviewApproved), // PLAN_REVIEW_APPROVED (inside runPlanReview)
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "hidday/lin-1-test-issue",
      labels: [],
      priority: 0,
      project: "test-project",
      url: "https://linear.app/issue/LIN-1",
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/repo"),
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
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn().mockResolvedValue(plan) };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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
    plannerAgent,
    planReviewerAgent,
    dashboardEmitter,
    logger,
  };
}

describe("OrchestratorService.startRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing active run without creating a new one when one already exists", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const existingRun = makeRun({ id: "existing-run", state: RunState.Planning });
    (runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(existingRun);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toEqual(existingRun);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });

  it("creates a run, sets up the worktree, emits runCreated, and proceeds to plan review when no blocking questions", async () => {
    const { deps, runRepo, gitService, dashboardEmitter, plannerAgent, linearClient } =
      buildDeps();

    const svc = new OrchestratorService(deps as never);
    const result = await svc.startRun("LIN-1");

    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: "LIN-1", repo: "test-repo" }),
    );
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/repo",
      "run-1",
      "main",
      "hidday/lin-1-test-issue",
    );
    expect(dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");
    expect(plannerAgent.run).toHaveBeenCalled();
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI planning started"),
    );

    // Ends up transitioning through RUN_REQUESTED, PLAN_CREATED, and then
    // (inside runPlanReview) PLAN_REVIEW_APPROVED, landing in AwaitingPlanApproval.
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the plan has blocking open questions", async () => {
    const blockingPlan = makePlan({
      openQuestions: [{ id: "q1", question: "Which auth method?", requiredForExecution: true }],
    });
    const { deps, runRepo, plannerAgent, planReviewerAgent } = buildDeps();
    (plannerAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue(blockingPlan);

    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded });
    (runRepo.updateState as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED (pre-clarification check uses PlanReview? no)
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION

    const svc = new OrchestratorService(deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);

    const eventTypes = (
      deps.eventRepo as { create: ReturnType<typeof vi.fn> }
    ).create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);

    // runPlanReview must NOT have been invoked when paused for clarification.
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("propagates the error when the issue cannot be retrieved from Linear", async () => {
    const { deps, linearClient } = buildDeps();
    (linearClient.getIssue as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Linear API down"),
    );

    const svc = new OrchestratorService(deps as never);
    await expect(svc.startRun("LIN-1")).rejects.toThrow("Linear API down");
  });
});
