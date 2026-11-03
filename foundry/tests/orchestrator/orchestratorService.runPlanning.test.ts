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
    branchName: "ai/run-1",
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
    plannerAgent,
    planReviewerAgent,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("re-plans with previousPlan, rejectionContext, humanAnswers, researchedAnswers and planReviewFindings when all prior artifacts exist", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

    runRepo.findById.mockResolvedValueOnce(planningRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    const previousPlan = makePlan({ planVersion: 2 });
    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });

    const rejectionContext = {
      planVersion: 1,
      feedback: "Use OAuth2",
      source: "api" as const,
      mode: "iterate" as const,
    };

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext") {
        return Promise.resolve(makeArtifact({ type: "RejectionContext", payloadJson: rejectionContext }));
      }
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      if (type === "HumanAnswers") {
        return Promise.resolve(
          makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }),
        );
      }
      if (type === "ResearchedAnswers") {
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: {
              summary: "s",
              answers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
              completedAt: "2026-01-01T00:00:00Z",
            },
          }),
        );
      }
      if (type === "PlanReview") {
        return Promise.resolve(
          makeArtifact({
            type: "PlanReview",
            payloadJson: { summary: "review summary", findings: [{ id: "f1", severity: "important", title: "t", details: "d" }] },
          }),
        );
      }
      return Promise.resolve(null);
    });

    plannerAgent.run.mockResolvedValue(newPlan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan,
        humanFeedback: { planVersion: 1, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
        planReviewFindings: {
          summary: "review summary",
          findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
        },
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("omits humanFeedback/humanAnswers/researchedAnswers/planReviewFindings when those artifacts don't exist", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    runRepo.findById.mockResolvedValueOnce(planningRun).mockResolvedValue(planReviewRun);
    runRepo.updateState.mockResolvedValueOnce(planReviewRun).mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.runPlanning("run-1");

    const callArgs = plannerAgent.run.mock.calls[0]?.[2];
    expect(callArgs).toEqual({ planVersionOverride: 2, previousPlan: newPlan });
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 });

    runRepo.findById.mockResolvedValue(planningRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // PLAN_CREATED (stays Planning-ish per fixture; actual state machine handled separately)
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    artifactRepo.findLatestByType.mockResolvedValue(null);

    const planWithBlocker = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(planWithBlocker);

    const result = await svc.runPlanning("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
