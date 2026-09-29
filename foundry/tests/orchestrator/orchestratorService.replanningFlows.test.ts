import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RejectionContextPayload, HumanAnswer } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ResearchedAnswers } from "../../src/schemas/researchedAnswers.js";

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
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

interface ArtifactStore {
  RejectionContext?: Artifact | null;
  Plan?: Artifact | null;
  HumanAnswers?: Artifact | null;
  ResearchedAnswers?: Artifact | null;
  PlanReview?: Artifact | null;
  TaskBundle?: Artifact | null;
}

function buildDeps(overrides: {
  run?: Run;
  newPlan?: Plan;
  artifacts?: ArtifactStore;
  repoByName?: unknown;
  defaultRepo?: unknown;
} = {}) {
  const run = overrides.run ?? makeRun();
  const newPlan = overrides.newPlan ?? makePlan();
  const previousPlan = makePlan({ planVersion: 1 });

  const store: ArtifactStore = {
    Plan: makeArtifact({ type: "Plan", version: 1, payloadJson: previousPlan }),
    ...overrides.artifacts,
  };

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
      if (type === "TaskBundle") return Promise.resolve(store.TaskBundle ?? null);
      if (type in store) return Promise.resolve((store as Record<string, Artifact | null>)[type]);
      return Promise.resolve(null);
    }),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1-test-issue",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(
      overrides.repoByName === undefined
        ? {
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
          }
        : overrides.repoByName,
    ),
    getDefaultRepo: vi.fn().mockReturnValue(
      overrides.defaultRepo ?? {
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
      },
    ),
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
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    },
    run,
    runRepo,
    plannerAgent,
    gitService,
    repoRegistry,
    githubClient,
    logger,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("injects prior plan, rejection feedback, human/researched answers and plan-review findings into the re-plan", async () => {
    const rejectionPayload: RejectionContextPayload = {
      planVersion: 1,
      feedback: "Needs more tests",
      source: "api",
      mode: "iterate",
    };
    const humanAnswersPayload = { answers: [{ questionId: "q1", answer: "prod" }] as HumanAnswer[] };
    const researchedAnswersPayload: ResearchedAnswers = {
      summary: "Researched",
      answers: [
        { questionId: "q1", question: "Which env?", answer: "prod", confidence: "high" },
      ],
      completedAt: new Date().toISOString(),
    };
    const planReviewPayload = {
      summary: "Needs a bit more detail",
      findings: [
        { id: "f1", severity: "important", title: "Vague", details: "be specific" },
      ],
    };

    const { deps, plannerAgent } = buildDeps({
      artifacts: {
        RejectionContext: makeArtifact({ type: "RejectionContext", payloadJson: rejectionPayload }),
        HumanAnswers: makeArtifact({ type: "HumanAnswers", payloadJson: humanAnswersPayload }),
        ResearchedAnswers: makeArtifact({ type: "ResearchedAnswers", payloadJson: researchedAnswersPayload }),
        PlanReview: makeArtifact({ type: "PlanReview", payloadJson: planReviewPayload }),
      },
      newPlan: makePlan({ planVersion: 2, openQuestions: [] }),
    });
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanFeedback: { planVersion: 1, feedback: "Needs more tests" },
        humanAnswers: humanAnswersPayload.answers,
        researchedAnswers: researchedAnswersPayload.answers,
        planReviewFindings: planReviewPayload,
      }),
    );
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("pauses for clarification when the re-plan still has blocking questions", async () => {
    const { deps } = buildDeps({
      newPlan: makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which region?", requiredForExecution: true }],
      }),
    });
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
  });

  it("calls plannerAgent.run without optional context fields when no prior artifacts exist", async () => {
    const { deps, plannerAgent } = buildDeps({
      artifacts: { Plan: null },
      newPlan: makePlan({ planVersion: 1, openQuestions: [] }),
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({
        humanFeedback: expect.anything(),
        humanAnswers: expect.anything(),
        researchedAnswers: expect.anything(),
        planReviewFindings: expect.anything(),
        previousPlan: expect.anything(),
      }),
    );
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branch yet", async () => {
    const { deps, runRepo, gitService } = buildDeps({
      run: makeRun({ state: RunState.Todo, branchName: null, workingDirectory: "/tmp/main" }),
      newPlan: makePlan({ openQuestions: [] }),
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp",
      "run-1",
      "main",
      "ai/lin-1-test-issue",
    );
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ workingDirectory: "/tmp/worktree", branchName: "ai/run-1" }),
    );
  });

  it("skips worktree setup when the run already has a branch", async () => {
    const { deps, gitService } = buildDeps({
      run: makeRun({ state: RunState.Todo, branchName: "ai/existing" }),
      newPlan: makePlan({ openQuestions: [] }),
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("falls back to the default repo when repoRegistry has no entry matching run.repo", async () => {
    const { deps, repoRegistry } = buildDeps({
      run: makeRun({ state: RunState.Todo, branchName: null, repo: "unknown-repo" }),
      newPlan: makePlan({ openQuestions: [] }),
      repoByName: null,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.retryRun("run-1");

    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });

  it("transitions RUN_REQUESTED, injects prior skills, and pauses on blocking questions", async () => {
    const { deps, runRepo } = buildDeps({
      run: makeRun({ state: RunState.Todo, branchName: "ai/existing" }),
      newPlan: makePlan({
        openQuestions: [{ id: "q1", question: "Which region?", requiredForExecution: true }],
      }),
    });
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.retryRun("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Planning);
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
  });

  it("proceeds to plan review when the re-plan has no blocking questions", async () => {
    const { deps } = buildDeps({
      run: makeRun({ state: RunState.Todo, branchName: "ai/existing" }),
      newPlan: makePlan({ openQuestions: [] }),
    });
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.retryRun("run-1");

    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });
});

describe("OrchestratorService -- buildTaskBundle default-branch reconciliation", () => {
  it("uses the remote default branch and logs a warning when it differs from config", async () => {
    const { deps, githubClient, plannerAgent, logger } = buildDeps({
      newPlan: makePlan({ openQuestions: [] }),
    });
    (githubClient.getDefaultBranch as ReturnType<typeof vi.fn>).mockResolvedValue("develop");
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "develop" }) }),
      "run-1",
      expect.anything(),
    );
    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("differs from GitHub"),
    );
    expect(warnCall).toBeDefined();
  });

  it("falls back to the config default branch and logs a warning when GitHub lookup throws", async () => {
    const { deps, githubClient, plannerAgent, logger } = buildDeps({
      newPlan: makePlan({ openQuestions: [] }),
    });
    (githubClient.getDefaultBranch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "main" }) }),
      "run-1",
      expect.anything(),
    );
    const warnCall = logger.warn.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Failed to resolve default branch"),
    );
    expect(warnCall).toBeDefined();
  });
});
