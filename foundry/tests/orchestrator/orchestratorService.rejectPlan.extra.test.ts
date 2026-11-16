import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

/**
 * Additional orchestratorService.rejectPlan coverage, beyond what
 * orchestratorService.rejectPlan.test.ts already exercises: the "iterate"
 * mode context-injection branches (loadReplanContext's humanAnswers /
 * researchedAnswers / planReviewFindings) and the blocking-questions-after-
 * rejection pause path. This file does not modify the existing, protected
 * orchestratorService.rejectPlan.test.ts.
 */

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
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
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
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn(),
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
    plannerAgent,
    planReviewerAgent,
  };
}

describe("OrchestratorService.rejectPlan (iterate-mode context injection)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("injects previousPlan, humanAnswers, researchedAnswers, and planReviewFindings loaded via loadReplanContext", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const runInitial = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    runRepo.findById
      .mockResolvedValueOnce(runInitial) // rejectPlan's requireRun
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 3 })); // runPlanReview's requireRun

    const priorPlan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: priorPlan }));
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
              answers: [{ questionId: "q2", question: "q2?", answer: "a2", confidence: "high" }],
              completedAt: new Date().toISOString(),
            },
          }),
        );
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({ type: "PlanReview", payloadJson: { summary: "review summary", findings: [] } }),
        );
      return Promise.resolve(null);
    });

    const newPlan = makePlan({ planVersion: 3 });
    plannerAgent.run.mockResolvedValue(newPlan);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 2 })) // PLAN_REJECTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 3 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 })); // PLAN_REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1", "needs rework", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          { questionId: "q2", question: "q2?", answer: "a2", confidence: "high" },
        ],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent, eventRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const blockingPlan = makePlan({
      planVersion: 3,
      openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(blockingPlan);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 2 })) // PLAN_REJECTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 3 })) // PLAN_CREATED
      .mockResolvedValueOnce(
        makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 3 }),
      ); // NEEDS_HUMAN_CLARIFICATION

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1", "needs rework");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });

  it("does not re-persist a TaskBundle artifact when one already exists for the run", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }))
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 3 }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "TaskBundle")
        return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: {} }));
      if (type === "Plan")
        return Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 3 }) }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3 }));
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 3 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 }));

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    const taskBundleCreateCalls = (artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "TaskBundle",
    );
    expect(taskBundleCreateCalls).toHaveLength(0);
  });
});
