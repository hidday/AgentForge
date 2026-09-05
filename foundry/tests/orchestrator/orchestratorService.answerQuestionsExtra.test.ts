import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
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
    branchName: "ai/run-1",
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
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
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
    plannerAgent,
  };
}

describe("OrchestratorService.answerQuestions -- additional branch coverage", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when no TaskBundle artifact exists for the run (HumanClarificationNeeded path)", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("loops back to HumanClarificationNeeded (not yet at max iterations) when blockers remain after re-planning", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which region?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Which provider?", requiredForExecution: true }],
    });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(
        makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 }),
      ); // NEEDS_HUMAN_CLARIFICATION (loop back)
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: taskBundle }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    // Only ONE prior NEEDS_HUMAN_CLARIFICATION event recorded so far -- below the
    // MAX_CLARIFICATION_ITERATIONS (3) threshold, so the loop-back branch (not
    // CLARIFICATION_EXHAUSTED) should be taken.
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "evt-1",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "us-east" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const clarificationEventCall = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(clarificationEventCall).toBeDefined();
    expect(
      (clarificationEventCall![0] as { payloadJson: { iteration: number } }).payloadJson.iteration,
    ).toBe(2);
  });
});
