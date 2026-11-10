import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
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
    workingDirectory: "/tmp/main",
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

function buildDeps(initialRun: Run) {
  let currentRun = initialRun;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      currentRun = { ...currentRun, state: newState };
      return Promise.resolve(currentRun);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return Promise.resolve(currentRun);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Title",
      description: "desc",
      branchName: "ai/lin-1",
      state: "Todo",
      labels: [],
      priority: 0,
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

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main"),
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    gitService,
    getCurrentRun: () => currentRun,
  };
}

describe("OrchestratorService.runPlanning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: re-plans, records PLAN_CREATED, and delegates to runPlanReview when there are no blocking questions", async () => {
    const built = buildDeps(makeRun({ state: RunState.Planning, planVersion: 1 }));
    const svc = new OrchestratorService(built.deps as never);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }) as Run);

    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledOnce();
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
    expect(built.getCurrentRun().state).toBe(RunState.PlanReview);
  });

  it("pauses for human clarification when the re-plan has blocking open questions, without calling runPlanReview", async () => {
    const built = buildDeps(makeRun({ state: RunState.Planning, planVersion: 1 }));
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "Which auth provider?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("persists a TaskBundle artifact exactly once (ensureTaskBundleArtifact is idempotent)", async () => {
    const built = buildDeps(makeRun({ state: RunState.Planning, planVersion: 1 }));
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    const taskBundleCalls = (built.artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "TaskBundle",
    );
    expect(taskBundleCalls).toHaveLength(1);
  });

  it("does not persist a TaskBundle artifact when one already exists for the run", async () => {
    const built = buildDeps(makeRun({ state: RunState.Planning, planVersion: 1 }));
    built.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "TaskBundle" ? Promise.resolve({ id: "tb-1" }) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    const taskBundleCalls = (built.artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "TaskBundle",
    );
    expect(taskBundleCalls).toHaveLength(0);
  });

  it("injects the previous Plan artifact into the planner call when one exists", async () => {
    const built = buildDeps(makeRun({ state: RunState.Planning, planVersion: 1 }));
    const priorPlan = makePlan({ planVersion: 1, summary: "Old plan" });
    built.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: priorPlan }) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ previousPlan: priorPlan }),
    );
  });

  it("injects prior HumanAnswers, ResearchedAnswers, and PlanReview findings artifacts into the planner call", async () => {
    const built = buildDeps(makeRun({ state: RunState.Planning, planVersion: 1 }));
    built.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "HumanAnswers") {
        return Promise.resolve({
          payloadJson: { answers: [{ questionId: "q1", answer: "staging" }] },
        });
      }
      if (type === "ResearchedAnswers") {
        return Promise.resolve({
          payloadJson: {
            answers: [
              { questionId: "q2", question: "x", answer: "y", confidence: "high" },
            ],
          },
        });
      }
      if (type === "PlanReview") {
        return Promise.resolve({
          payloadJson: { summary: "Needs tweaks", findings: [{ id: "f1" }] },
        });
      }
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "staging" }],
        researchedAnswers: [{ questionId: "q2", question: "x", answer: "y", confidence: "high" }],
        planReviewFindings: { summary: "Needs tweaks", findings: [{ id: "f1" }] },
      }),
    );
  });

  it("injects humanFeedback from the latest RejectionContext artifact into the planner call", async () => {
    const built = buildDeps(makeRun({ state: RunState.Planning, planVersion: 1 }));
    built.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "RejectionContext") {
        return Promise.resolve({
          payloadJson: { planVersion: 1, feedback: "Use OAuth2", source: "api", mode: "iterate" },
        });
      }
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanFeedback: { planVersion: 1, feedback: "Use OAuth2" },
      }),
    );
  });
});

describe("OrchestratorService.retryRun", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new worktree when the run has no branchName yet", async () => {
    const built = buildDeps(makeRun({ state: RunState.Todo, branchName: null }));
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalledOnce();
    expect(built.getCurrentRun().branchName).toBe("ai/run-1");
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const built = buildDeps(makeRun({ state: RunState.Todo, branchName: "ai/existing" }));
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.retryRun("run-1");

    expect(built.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("happy path: transitions Todo -> Planning -> PlanReview and delegates to runPlanReview", async () => {
    const built = buildDeps(makeRun({ state: RunState.Todo, branchName: "ai/existing" }));
    const svc = new OrchestratorService(built.deps as never);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }) as Run);

    await svc.retryRun("run-1");

    const eventTypes = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.RUN_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("pauses for human clarification when the plan has blocking open questions", async () => {
    const built = buildDeps(makeRun({ state: RunState.Todo, branchName: "ai/existing" }));
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.retryRun("run-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("falls back to the default repo when the run's repo is not found in the registry", async () => {
    const built = buildDeps(makeRun({ state: RunState.Todo, branchName: null }));
    (built.deps.repoRegistry.getRepoByName as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const defaultRepo = {
      name: "default-repo",
      defaultBranch: "main",
      allowedPaths: [],
      protectedPaths: [],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    };
    (built.deps.repoRegistry.getDefaultRepo as ReturnType<typeof vi.fn>).mockReturnValue(defaultRepo);
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.retryRun("run-1");

    expect(built.deps.repoRegistry.getDefaultRepo).toHaveBeenCalled();
    expect(built.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main",
      "run-1",
      "main",
      "ai/lin-1",
    );
  });
});
