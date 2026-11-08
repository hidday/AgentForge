import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RejectionContextPayload } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
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

function makeArtifact(overrides: Partial<Artifact> & { type: string }): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  } as Artifact;
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

  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "hidday/lin-1-test",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
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
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "OK", findings: [] }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test" }),
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
    plannerAgent,
    planReviewerAgent,
    gitService,
    logger,
  };
}

/**
 * Wires findLatestByType(_, "Plan") to return `priorPlan` (wrapped as an
 * artifact) up until the planner has produced `newPlan`, after which it
 * returns `newPlan` (simulating the real PlannerAgent persisting the new
 * Plan artifact, then runPlanReview reading it back).
 */
function wirePlanArtifactSequence(
  artifactRepo: { findLatestByType: ReturnType<typeof vi.fn> },
  priorPlan: Plan | null,
  newPlan: Plan,
  extra?: (type: string) => Artifact | null,
) {
  let callCount = 0;
  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "Plan") {
      callCount += 1;
      // First lookup (before planner runs) returns the prior plan (or null
      // when there is none); every subsequent lookup (runPlanReview et al.)
      // returns the new plan, simulating the real PlannerAgent persisting it.
      if (callCount === 1) {
        return Promise.resolve(
          priorPlan ? makeArtifact({ type, version: priorPlan.planVersion, payloadJson: priorPlan }) : null,
        );
      }
      return Promise.resolve(makeArtifact({ type, version: newPlan.planVersion, payloadJson: newPlan }));
    }
    const extraResult = extra?.(type);
    if (extraResult !== undefined) return Promise.resolve(extraResult);
    return Promise.resolve(null);
  });
}

describe("OrchestratorService.runPlanning", () => {
  it("injects previousPlan, humanFeedback, humanAnswers, researchedAnswers and planReviewFindings when all prior artifacts exist, then proceeds to plan review", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });

    runRepo.findById.mockResolvedValueOnce(planningRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    const previousPlan = makePlan({ planVersion: 1 });
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    const rejectionPayload: RejectionContextPayload = {
      planVersion: 1,
      feedback: "Needs rework",
      source: "api",
      mode: "iterate",
    };

    wirePlanArtifactSequence(artifactRepo, previousPlan, newPlan, (type) => {
      if (type === "RejectionContext")
        return makeArtifact({ type, version: 1, payloadJson: rejectionPayload });
      if (type === "HumanAnswers")
        return makeArtifact({ type, version: 1, payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } });
      if (type === "ResearchedAnswers")
        return makeArtifact({
          type,
          version: 1,
          payloadJson: {
            summary: "s",
            answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" }],
            completedAt: "2026-01-01T00:00:00Z",
          },
        });
      if (type === "PlanReview")
        return makeArtifact({
          type,
          version: 1,
          payloadJson: {
            summary: "review summary",
            findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
          },
        });
      return null;
    });

    plannerAgent.run.mockResolvedValue(newPlan);

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan,
        humanFeedback: { planVersion: 1, feedback: "Needs rework" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" }],
        planReviewFindings: {
          summary: "review summary",
          findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
        },
      }),
    );
    expect(result).toBeDefined();
  });

  it("omits optional planner options when no prior artifacts exist", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });

    runRepo.findById.mockResolvedValueOnce(planningRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    wirePlanArtifactSequence(artifactRepo, null, newPlan);
    plannerAgent.run.mockResolvedValue(newPlan);

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ humanFeedback: expect.anything() }),
    );
    const callOpts = plannerAgent.run.mock.calls[0][2];
    expect(callOpts.previousPlan).toBeUndefined();
    expect(callOpts.humanAnswers).toBeUndefined();
    expect(callOpts.researchedAnswers).toBeUndefined();
    expect(callOpts.planReviewFindings).toBeUndefined();
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    const blockingPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(blockingPlan);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ blockingCount: 1 }),
      "Re-plan has blocking questions, pausing for human clarification",
    );
  });
});

describe("OrchestratorService.retryRun", () => {
  it("reuses the existing worktree when the run already has a branchName", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch", planVersion: 1 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });

    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 1 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 1 }));

    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan"
        ? Promise.resolve(makeArtifact({ type, version: newPlan.planVersion, payloadJson: newPlan }))
        : Promise.resolve(null),
    );
    plannerAgent.run.mockResolvedValue(newPlan);

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("sets up a new worktree when the run has no branchName, then proceeds to plan review", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: null, planVersion: 1 });
    const planningRunAfterRequest = makeRun({ state: RunState.Planning, planVersion: 1 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });

    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(planReviewRun);
    runRepo.update
      .mockResolvedValueOnce(makeRun({ ...run, workingDirectory: "/tmp/worktree", branchName: "ai/run-test" }))
      .mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 1 }));
    runRepo.updateState
      .mockResolvedValueOnce(planningRunAfterRequest)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }));

    const newPlan = makePlan({ planVersion: 1, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan"
        ? Promise.resolve(makeArtifact({ type, version: newPlan.planVersion, payloadJson: newPlan }))
        : Promise.resolve(null),
    );
    plannerAgent.run.mockResolvedValue(newPlan);

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith("/tmp", "run-1", "main", "hidday/lin-1-test");
    expect(result).toBeDefined();
  });

  it("pauses for human clarification when the retried plan has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing-branch", planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 })) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 1 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 })); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 1 }));

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 1, openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }] }),
    );

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
