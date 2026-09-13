import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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
    openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
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

function buildDeps(overrides: {
  run?: Run;
  plan?: Plan | null;
  taskBundle?: TaskBundle | null;
  newPlan?: Plan;
  events?: RunEventRecord[];
} = {}) {
  const run = overrides.run ?? makeRun();
  const plan = overrides.plan === undefined ? makePlan() : overrides.plan;
  const taskBundle = overrides.taskBundle === undefined ? makeTaskBundle() : overrides.taskBundle;
  const newPlan = overrides.newPlan ?? makePlan({ planVersion: 2 });

  let currentRun: Run = { ...run };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      currentRun = { ...currentRun, state };
      return Promise.resolve({ ...currentRun });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return Promise.resolve({ ...currentRun });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(plan ? makeArtifact({ type: "Plan", payloadJson: plan }) : null);
      }
      if (type === "TaskBundle") {
        return Promise.resolve(
          taskBundle ? makeArtifact({ type: "TaskBundle", payloadJson: taskBundle }) : null,
        );
      }
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue(overrides.events ?? []),
  };

  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
  const githubClient = { getPRDiff: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };
  const plannerAgent = { run: vi.fn().mockResolvedValue(newPlan) };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
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
    },
    run,
    eventRepo,
  };
}

describe("OrchestratorService.answerQuestions -- edge cases", () => {
  it("throws when there is no plan artifact for the run", async () => {
    const { deps } = buildDeps({ plan: null });
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when the original TaskBundle artifact is missing after clarification is provided", async () => {
    const { deps } = buildDeps({ taskBundle: null });
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("re-transitions to HumanClarificationNeeded with an incremented iteration when blockers remain and max iterations is not yet reached", async () => {
    const stillBlockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Which region?", requiredForExecution: true }],
    });
    const priorClarificationEvent = {
      id: "evt-1",
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string,
      source: "planner-agent",
      payloadJson: {},
      createdAt: new Date(),
    };
    const { deps, eventRepo } = buildDeps({
      newPlan: stillBlockedPlan,
      events: [priorClarificationEvent],
    });
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    const clarificationCalls = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(clarificationCalls).toHaveLength(1);
    const payload = (clarificationCalls[0][0] as {
      payloadJson: { iteration: number; blockingQuestions: { id: string }[] };
    }).payloadJson;
    expect(payload.iteration).toBe(2);
    expect(payload.blockingQuestions).toEqual([{ id: "q2", question: "Which region?" }]);
  });

  it("proceeds to plan review when the re-plan has no remaining blocking questions", async () => {
    const { deps } = buildDeps({ newPlan: makePlan({ planVersion: 2, openQuestions: [] }) });
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });
});
