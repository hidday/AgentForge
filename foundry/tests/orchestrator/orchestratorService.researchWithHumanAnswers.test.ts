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

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: `artifact-${overrides.type}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

interface Store {
  run: Run;
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
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
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

  const defaultRepoEntry = {
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
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
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
  const answerResearcherAgent = { run: vi.fn() };
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
      answerResearcherAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    artifactRepo,
    plannerAgent,
    answerResearcherAgent,
    eventRepo,
  };
}

describe("OrchestratorService.maybeResearchAndReplan -- prior HumanAnswers injected into research + re-plan", () => {
  it("includes the existing HumanAnswers artifact in both the researcher call and the research re-plan call", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run };
    const { deps, artifactRepo, plannerAgent, answerResearcherAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const humanAnswersPayload = { answers: [{ questionId: "q0", answer: "from a prior round" }] };

    // Plan returned by the initial plannerAgent.run call inside rejectPlan has open
    // questions, triggering maybeResearchAndReplan. No ResearchedAnswers artifact
    // exists yet, so the researcher should fire, picking up the HumanAnswers
    // artifact that is already on file.
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "HumanAnswers")
        return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: humanAnswersPayload }));
      return Promise.resolve(null);
    });

    const firstPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Unresolved?", requiredForExecution: false }],
    });
    const revisedPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockResolvedValueOnce(firstPlan).mockResolvedValueOnce(revisedPlan);

    answerResearcherAgent.run.mockResolvedValue({
      summary: "researched",
      answers: [{ questionId: "q1", question: "Unresolved?", answer: "Resolved", confidence: "high" }],
      completedAt: new Date().toISOString(),
    });

    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...store.run, state: RunState.PlanReview });

    await svc.rejectPlan("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      firstPlan,
      expect.anything(),
      "run-1",
      { humanAnswers: humanAnswersPayload.answers },
    );

    // Second plannerAgent.run call is the post-research re-plan.
    const secondCallArgs = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCallArgs[2]).toMatchObject({
      previousPlan: firstPlan,
      humanAnswers: humanAnswersPayload.answers,
    });
  });
});
