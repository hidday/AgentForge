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
    update: vi.fn(),
    updateState: vi.fn(),
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
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };

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
    postExecutionReportUpdate: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
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
    logger,
  };
}

describe("OrchestratorService.runPlanning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("injects previousPlan, humanFeedback, humanAnswers, researchedAnswers, and planReviewFindings when all prior artifacts exist, then proceeds to plan review", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    runRepo.findById
      .mockResolvedValueOnce(run) // runPlanning's requireRun
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 3 })); // runPlanReview's requireRun

    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "RejectionContext")
        return Promise.resolve(
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 2, feedback: "be careful", source: "api", mode: "iterate" },
          }),
        );
      if (type === "Plan")
        return Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 2 }) }));
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({
            type: "HumanAnswers",
            payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
          }),
        );
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: {
              summary: "research",
              answers: [
                { questionId: "q2", question: "q2?", answer: "a2", confidence: "high" },
              ],
              completedAt: new Date().toISOString(),
            },
          }),
        );
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({
            type: "PlanReview",
            payloadJson: { summary: "review summary", findings: [] },
          }),
        );
      return Promise.resolve(null);
    });

    const newPlan = makePlan({ planVersion: 3 });
    plannerAgent.run.mockResolvedValue(newPlan);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 3 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 })); // PLAN_REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanFeedback: { planVersion: 2, feedback: "be careful" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          { questionId: "q2", question: "q2?", answer: "a2", confidence: "high" },
        ],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
    expect(planReviewerAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("calls plannerAgent.run with only planVersionOverride when no prior artifacts exist", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 }))
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 2 }));
    let planLookups = 0;
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type !== "Plan") return Promise.resolve(null);
      planLookups += 1;
      // 1st call: runPlanning's own "previousPlan" lookup (none exists yet).
      // 2nd+ call: runPlanReview's lookup, after the planner "persisted" the new plan.
      return Promise.resolve(
        planLookups === 1 ? null : makeArtifact({ payloadJson: makePlan({ planVersion: 2 }) }),
      );
    });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(expect.anything(), "run-1", {
      planVersionOverride: 2,
    });
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 1 }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const blockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(blockingPlan);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 })); // NEEDS_HUMAN_CLARIFICATION

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets up a worktree when run.branchName is not set, then plans and proceeds to plan review", async () => {
    const { deps, runRepo, artifactRepo, gitService, plannerAgent } = buildDeps();
    const run = makeRun({ state: RunState.Todo, branchName: null, workingDirectory: "/tmp/repo" });
    runRepo.findById
      .mockResolvedValueOnce(run) // retryRun's requireRun
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 2 })); // runPlanReview's requireRun
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 2 }) })) : null,
    );
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Todo, branchName: "ai/run-1", workingDirectory: "/tmp/worktree" })) // worktree update
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/run-1", planVersion: 2 })); // planVersion update
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/run-1" })) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 })); // PLAN_REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith("/tmp", "run-1", "main", "ai/lin-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when run.branchName is already set", async () => {
    const { deps, runRepo, artifactRepo, gitService, plannerAgent } = buildDeps();
    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing" });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 2 }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 2 }) })) : null,
    );
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, branchName: "ai/existing", planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/existing" }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the re-plan has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo, branchName: "ai/existing" }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const blockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which cloud?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(blockingPlan);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/existing" })) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 })); // NEEDS_HUMAN_CLARIFICATION

    const svc = new OrchestratorService(deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
