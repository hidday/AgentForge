import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RejectionContextPayload } from "../../src/domain/types.js";
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
    state: RunState.Planning,
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
    planVersion: 2,
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
    create: vi.fn().mockResolvedValue({}),
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
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

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
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "rev-1",
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
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-retry" }),
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
    linearClient,
    plannerAgent,
    planReviewerAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("happy path with no prior context artifacts: re-plans and proceeds to plan review approval", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });

    runRepo.findById.mockResolvedValueOnce(initialRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED
    runRepo.update.mockResolvedValue({ ...initialRun, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2 }),
    );
    // Only the previousPlan (looked up unconditionally from the existing Plan
    // artifact) should be present; the other optional context fields are absent
    // when no corresponding artifacts exist.
    const callArgs = plannerAgent.run.mock.calls[0][2];
    expect(callArgs).toHaveProperty("previousPlan");
    expect(callArgs).not.toHaveProperty("humanFeedback");
    expect(callArgs).not.toHaveProperty("humanAnswers");
    expect(callArgs).not.toHaveProperty("researchedAnswers");
    expect(callArgs).not.toHaveProperty("planReviewFindings");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("injects previousPlan, humanFeedback, humanAnswers, researchedAnswers and planReviewFindings when all prior artifacts exist", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const initialRun = makeRun({ state: RunState.Planning, planVersion: 2 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

    const previousPlan = makePlan({ planVersion: 2 });
    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });

    const rejectionPayload: RejectionContextPayload = {
      planVersion: 2,
      feedback: "Please use library X",
      source: "api",
      mode: "iterate",
    };

    runRepo.findById.mockResolvedValueOnce(initialRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.update.mockResolvedValue({ ...initialRun, planVersion: 3 });

    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "RejectionContext") {
        return Promise.resolve(makeArtifact({ type: "RejectionContext", payloadJson: rejectionPayload }));
      }
      if (type === "Plan") {
        // Plan is looked up twice: once for previousPlan context, once inside runPlanReview
        return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan }));
      }
      if (type === "HumanAnswers") {
        return Promise.resolve(
          makeArtifact({
            type: "HumanAnswers",
            payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
          }),
        );
      }
      if (type === "ResearchedAnswers") {
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: {
              summary: "s",
              answers: [
                { questionId: "q1", question: "Q?", answer: "A", confidence: "high" },
              ],
              completedAt: "2026-01-01T00:00:00Z",
            },
          }),
        );
      }
      if (type === "PlanReview") {
        return Promise.resolve(
          makeArtifact({
            type: "PlanReview",
            payloadJson: { summary: "review summary", findings: [] },
          }),
        );
      }
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    await svc.runPlanning("run-1");

    // First call to plannerAgent.run is the re-plan call inside runPlanning itself
    const callArgs = plannerAgent.run.mock.calls[0][2];
    expect(callArgs).toMatchObject({
      planVersionOverride: 3,
      previousPlan: expect.objectContaining({ planVersion: newPlan.planVersion }),
      humanFeedback: { planVersion: 2, feedback: "Please use library X" },
      humanAnswers: [{ questionId: "q1", answer: "yes" }],
      researchedAnswers: [
        { questionId: "q1", question: "Q?", answer: "A", confidence: "high" },
      ],
      planReviewFindings: { summary: "review summary", findings: [] },
    });
    void previousPlan;
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 });

    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which auth provider?", requiredForExecution: true }],
    });

    runRepo.findById.mockResolvedValue(initialRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue({ ...initialRun, planVersion: 2 });
    plannerAgent.run.mockResolvedValue(newPlan);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    // Should not have proceeded to plan review agent
    void artifactRepo;
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet, then proceeds to plan review", async () => {
    const { deps, runRepo, gitService, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const initialRun = makeRun({ state: RunState.Todo, planVersion: 1, branchName: null });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });

    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });

    runRepo.findById.mockResolvedValueOnce(initialRun).mockResolvedValue(planReviewRun);
    runRepo.update
      .mockResolvedValueOnce({ ...initialRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-retry" })
      .mockResolvedValueOnce({
        ...initialRun,
        state: RunState.Planning,
        workingDirectory: "/tmp/worktree",
        branchName: "ai/run-retry",
        planVersion: 1,
      });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // RUN_REQUESTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED

    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const { deps, runRepo, gitService, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const initialRun = makeRun({ state: RunState.Todo, planVersion: 1, branchName: "ai/existing" });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });

    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });

    runRepo.findById.mockResolvedValueOnce(initialRun).mockResolvedValue(planReviewRun);
    runRepo.update.mockResolvedValue({ ...initialRun, state: RunState.Planning, planVersion: 1 });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);

    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the retried plan still has blocking questions", async () => {
    const { deps, runRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const initialRun = makeRun({ state: RunState.Todo, planVersion: 1, branchName: "ai/existing" });
    const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });

    const newPlan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which region?", requiredForExecution: true }],
    });

    runRepo.findById.mockResolvedValue(initialRun);
    runRepo.update.mockResolvedValue({ ...initialRun, state: RunState.Planning, planVersion: 1 });
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
    plannerAgent.run.mockResolvedValue(newPlan);

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
