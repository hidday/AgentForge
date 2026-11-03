import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { ValidationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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
    state: RunState.HumanClarificationNeeded,
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
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };

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
    dashboardEmitter,
  };
}

describe("OrchestratorService.answerQuestions -- additional branches", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.answerQuestions("missing-run", [])).rejects.toThrow("Run not found: missing-run");
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when no TaskBundle artifact exists after re-planning is triggered", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const planningRun = makeRun({ state: RunState.Planning });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(planningRun); // CLARIFICATION_PROVIDED

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("preserves prior researched answers when re-planning with human answers", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingRun); // PLAN_REVIEW_APPROVED
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: taskBundle }));
      if (type === "ResearchedAnswers") {
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: {
              summary: "s",
              answers: [{ questionId: "q1", question: "Q", answer: "prior answer", confidence: "medium" }],
              completedAt: "2026-01-01T00:00:00Z",
            },
          }),
        );
      }
      return Promise.resolve(null);
    });

    plannerAgent.run.mockResolvedValue(newPlan);
    (deps as never as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });
    (deps as never as { linearClient: { getIssue: ReturnType<typeof vi.fn> } }).linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    });
    (deps as never as { repoRegistry: { getRepoByName: ReturnType<typeof vi.fn> } }).repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      taskBundle,
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q1", question: "Q", answer: "prior answer", confidence: "medium" }],
        planVersionOverride: 2,
      }),
    );
  });

  it("transitions back to HumanClarificationNeeded (not Failed) when blockers remain and iteration count is below the max", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
    });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: taskBundle }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    // Only 1 prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3)
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent", payloadJson: {}, createdAt: new Date() },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still confused" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const clarificationEventCall = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "NEEDS_HUMAN_CLARIFICATION",
    );
    expect(clarificationEventCall?.[0]).toMatchObject({
      payloadJson: expect.objectContaining({ iteration: 2 }),
    });
  });

  it("rejects an unrecognised questionId even when multiple valid ones exist", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan({
      openQuestions: [
        { id: "q1", question: "A?", requiredForExecution: false },
        { id: "q2", question: "B?", requiredForExecution: false },
      ],
    });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    await expect(
      svc.answerQuestions("run-1", [
        { questionId: "q1", answer: "yes" },
        { questionId: "nope", answer: "huh" },
      ]),
    ).rejects.toThrow(ValidationError);
  });
});
