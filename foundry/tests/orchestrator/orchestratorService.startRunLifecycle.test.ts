import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RejectionContextPayload, HumanAnswer } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { ResearchedAnswers } from "../../src/schemas/researchedAnswers.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
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

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
  };
}

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
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
      identifier: "ENG-1",
      title: "Test issue",
      description: "Test description",
      url: "https://linear.app/x/ENG-1",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "proj",
      team: "team",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };

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
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/repo"),
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
    gitService,
    repoRegistry,
    plannerAgent,
    planReviewerAgent,
    dashboardEmitter,
    logger,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one when one already exists for the issue", async () => {
    const { deps, runRepo, linearClient, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const existing = makeRun({ id: "run-existing", state: RunState.Implementing });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(linearClient.getIssue).not.toHaveBeenCalled();
    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(runRepo.create).not.toHaveBeenCalled();
  });

  it("creates the run, sets up the worktree, emits runCreated, and proceeds through plan review to AwaitingPlanApproval", async () => {
    const { deps, runRepo, artifactRepo, dashboardEmitter, plannerAgent, planReviewerAgent, linearClient } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValueOnce(planningRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED
    runRepo.findById.mockResolvedValue(planReviewRun);

    const clearPlan = makePlan({ openQuestions: [] });
    plannerAgent.run.mockResolvedValue(clearPlan);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, clearPlan));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    });

    const result = await svc.startRun("LIN-1");

    expect(dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI planning started"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    // Plan review approved comment should include the formatted plan summary.
    const approvedComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI plan review: approved"),
    );
    expect(approvedComment).toBeDefined();
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans with previousPlan, rejectionContext, humanAnswers, researchedAnswers and planReviewFindings injected, then proceeds to plan review", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planningRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 3 });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 3 });

    runRepo.findById.mockResolvedValueOnce(planningRun).mockResolvedValue(planReviewRun);
    runRepo.updateState.mockResolvedValueOnce(planReviewRun).mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 3 });

    const previousPlan = makePlan({ planVersion: 2 });
    const revisedPlan = makePlan({ planVersion: 3, openQuestions: [] });

    const rejectionPayload: RejectionContextPayload = {
      planVersion: 2,
      feedback: "please use OAuth2",
      source: "api",
      mode: "iterate",
    };
    const humanAnswersPayload = { answers: [{ questionId: "q1", answer: "yes" } as HumanAnswer] };
    const researchedAnswersPayload: ResearchedAnswers = {
      summary: "research",
      answers: [
        { questionId: "q1", question: "Q?", answer: "A", confidence: "high" },
      ],
      completedAt: new Date().toISOString(),
    };
    const planReviewPayload = {
      summary: "review summary",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext") return Promise.resolve(asArtifact("RejectionContext", 2, rejectionPayload));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 2, previousPlan));
      if (type === "HumanAnswers") return Promise.resolve(asArtifact("HumanAnswers", 1, humanAnswersPayload));
      if (type === "ResearchedAnswers")
        return Promise.resolve(asArtifact("ResearchedAnswers", 1, researchedAnswersPayload));
      if (type === "PlanReview") return Promise.resolve(asArtifact("PlanReview", 1, planReviewPayload));
      return Promise.resolve(null);
    });

    plannerAgent.run.mockResolvedValue(revisedPlan);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanFeedback: { planVersion: 2, feedback: "please use OAuth2" },
        humanAnswers: humanAnswersPayload.answers,
        researchedAnswers: researchedAnswersPayload.answers,
        planReviewFindings: planReviewPayload,
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan still has blocking open questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planningRun = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const clarificationRun = makeRun({
      id: "run-1",
      state: RunState.HumanClarificationNeeded,
      planVersion: 2,
    });

    runRepo.findById.mockResolvedValue(planningRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // PLAN_CREATED
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

    const blockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(blockedPlan);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet, then plans and reviews", async () => {
    const { deps, runRepo, artifactRepo, gitService, plannerAgent, planReviewerAgent, repoRegistry } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const runNoBranch = makeRun({ id: "run-1", state: RunState.Todo, branchName: null });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });

    runRepo.findById.mockResolvedValueOnce(runNoBranch).mockResolvedValue(planReviewRun);
    runRepo.update
      .mockResolvedValueOnce({ ...runNoBranch, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValue(planningRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED

    const clearPlan = makePlan({ openQuestions: [] });
    plannerAgent.run.mockResolvedValue(clearPlan);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, clearPlan));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/repo",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(repoRegistry.getRepoByName).toHaveBeenCalledWith("test-repo");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName, and still re-plans", async () => {
    const { deps, runRepo, artifactRepo, gitService, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const runWithBranch = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning, branchName: "ai/existing" });
    const planReviewRun = makeRun({ id: "run-1", state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });

    runRepo.findById.mockResolvedValueOnce(runWithBranch).mockResolvedValue(planReviewRun);
    runRepo.update.mockResolvedValue(planningRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);

    const clearPlan = makePlan({ openQuestions: [] });
    plannerAgent.run.mockResolvedValue(clearPlan);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, clearPlan));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the fresh plan has blocking open questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const runWithBranch = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    const planningRun = makeRun({ id: "run-1", state: RunState.Planning });
    const clarificationRun = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded });

    runRepo.findById.mockResolvedValue(runWithBranch);
    runRepo.update.mockResolvedValue(planningRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(planningRun) // PLAN_CREATED
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION

    const blockedPlan = makePlan({
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(blockedPlan);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
