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
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 2,
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
    version: 2,
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
    plannerAgent,
    planReviewerAgent,
  };
}

describe("OrchestratorService.rejectPlan -- fresh mode and iterate-context branches", () => {
  it("in 'fresh' mode, does NOT load prior plan/humanAnswers/researchedAnswers/planReviewFindings context", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });
    const approvedRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

    runRepo.findById.mockResolvedValueOnce(awaitingRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // PLAN_REJECTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(approvedRun); // PLAN_REVIEW_APPROVED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    // These would be returned if "fresh" mode incorrectly called loadReplanContext.
    const priorPlan = makePlan({ planVersion: 2, summary: "SHOULD NOT BE USED" });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: priorPlan }));
      return Promise.resolve(null);
    });

    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    (deps as never as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.rejectPlan("run-1", "start over please", "api", "fresh");

    const callOpts = plannerAgent.run.mock.calls[0]?.[2];
    expect(callOpts).not.toHaveProperty("previousPlan");
    expect(callOpts).not.toHaveProperty("humanAnswers");
    expect(callOpts).not.toHaveProperty("researchedAnswers");
    expect(callOpts).not.toHaveProperty("planReviewFindings");
  });

  it("in 'iterate' mode, injects previousPlan, humanAnswers, researchedAnswers and planReviewFindings when all exist", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });
    const approvedRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

    runRepo.findById.mockResolvedValueOnce(awaitingRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(approvedRun);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    const previousPlan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      if (type === "RejectionContext") {
        return Promise.resolve(
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 2, feedback: "iterate feedback", source: "api", mode: "iterate" },
          }),
        );
      }
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

    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    (deps as never as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.rejectPlan("run-1", "please reconsider", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan,
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
        planReviewFindings: {
          summary: "review summary",
          findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
        },
      }),
    );
  });

  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 3 });

    runRepo.findById.mockResolvedValue(awaitingRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // PLAN_REJECTED
      .mockResolvedValueOnce(planningRun) // PLAN_CREATED (stays Planning-shaped per fixture)
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    artifactRepo.findLatestByType.mockResolvedValue(null);

    const planWithBlocker = makePlan({
      planVersion: 3,
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(planWithBlocker);

    const result = await svc.rejectPlan("run-1", "still unclear", "api", "fresh");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
