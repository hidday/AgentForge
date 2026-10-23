import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RejectionContextPayload } from "../../src/domain/types.js";
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

/**
 * Builds a mocked dependency set backed by a mutable `store.run` so that
 * runRepo.update / updateState calls (in any order, any number of times)
 * correctly thread state changes through — matching production semantics
 * instead of brittle call-sequenced mocks.
 */
function buildDeps(initialRun: Run, overrides: Record<string, unknown> = {}) {
  const store: { run: Run } = { run: { ...initialRun } };

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
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test" }),
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
    store,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-runs the planner with no prior context, transitions PLAN_CREATED and proceeds to plan review when no blockers", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.findLatestByType.mockResolvedValue(null); // no previous plan / feedback / answers / review

    const runReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue({
      ...run,
      state: RunState.PlanReview,
    });

    const result = await svc.runPlanning("run-1");

    const callArgs = (plannerAgent.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).toBe("run-1");
    expect(callArgs[2]).not.toHaveProperty("previousPlan");
    expect(callArgs[2]).not.toHaveProperty("humanFeedback");
    expect(callArgs[2]).not.toHaveProperty("humanAnswers");
    expect(callArgs[2]).not.toHaveProperty("researchedAnswers");
    expect(callArgs[2]).not.toHaveProperty("planReviewFindings");
    expect(callArgs[2].planVersionOverride).toBe(2);

    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBeDefined();
  });

  it("injects previousPlan, humanFeedback, humanAnswers, researchedAnswers, and planReviewFindings when all prior artifacts exist", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const { deps, artifactRepo, plannerAgent } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const previousPlan = makePlan({ planVersion: 2 });
    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);

    const rejectionContext: RejectionContextPayload = {
      planVersion: 2,
      feedback: "Use OAuth2",
      source: "api",
      mode: "iterate",
    };
    const humanAnswersPayload = { answers: [{ questionId: "q1", answer: "yes" }] };
    const researchedAnswersPayload = {
      summary: "s",
      answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" as const }],
      completedAt: new Date().toISOString(),
    };
    const planReviewPayload = {
      summary: "review summary",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext")
        return Promise.resolve(
          makeArtifact({ type: "RejectionContext", payloadJson: rejectionContext }),
        );
      if (type === "Plan")
        return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({ type: "HumanAnswers", payloadJson: humanAnswersPayload }),
        );
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({ type: "ResearchedAnswers", payloadJson: researchedAnswersPayload }),
        );
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReviewPayload }));
      return Promise.resolve(null);
    });

    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...run, state: RunState.PlanReview });

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan,
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2" },
        humanAnswers: humanAnswersPayload.answers,
        researchedAnswers: researchedAnswersPayload.answers,
        planReviewFindings: planReviewPayload,
      }),
    );
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.findLatestByType.mockResolvedValue(null);
    eventRepo.findByRunId.mockResolvedValue([]);

    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null, planVersion: 1 });
    const { deps, artifactRepo, plannerAgent, gitService } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...run, state: RunState.PlanReview });

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(result.state).toBe(RunState.PlanReview);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing", planVersion: 1 });
    const { deps, artifactRepo, plannerAgent, gitService } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({ openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    vi.spyOn(svc, "runPlanReview").mockResolvedValue({ ...run, state: RunState.PlanReview });

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when blocking questions remain", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing", planVersion: 1 });
    const { deps, artifactRepo, plannerAgent, eventRepo } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const newPlan = makePlan({
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    artifactRepo.findLatestByType.mockResolvedValue(null);
    eventRepo.findByRunId.mockResolvedValue([]);

    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.retryRun("run-1");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, records PLAN_REVISED, and posts the combined comment", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const { deps, artifactRepo, planReviserAgent, linearClient } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const planReview = {
      reviewId: "pr-1",
      summary: "summary",
      findings: [{ id: "f1", severity: "important", type: "bug", title: "t", details: "d" }],
      overallVerdict: "changes_requested" as const,
    };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      return Promise.resolve(null);
    });

    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed" }],
      },
      revisedPlan,
    });

    const result = await svc.runPlanRevision("run-1", { note: "please double check" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "please double check" },
    );
    expect(result.planVersion).toBe(2);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(commentCall[1]).toContain("Plan Revision Dispositions");
    expect(commentCall[1]).toContain("Revised after AI review");
  });

  it("calls planReviserAgent.run without an operatorNote when none is given", async () => {
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const { deps, artifactRepo, planReviserAgent } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const planReview = {
      reviewId: "pr-1",
      summary: "summary",
      findings: [],
      overallVerdict: "changes_requested" as const,
    };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      return Promise.resolve(null);
    });

    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("records approvedPlanVersion, transitions PLAN_APPROVED, and posts a comment without an operator note", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, artifactRepo, linearClient } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    const result = await svc.approvePlan("run-1");

    expect(result.approvedPlanVersion).toBe(2);
    expect(result.state).toBe(RunState.Implementing);
    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(commentCall[1]).toBe("Plan v2 approved. Starting implementation...");
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, artifactRepo, linearClient } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    await svc.approvePlan("run-1", { note: "ship it" });

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(commentCall[1]).toContain("approved with operator note");
    expect(commentCall[1]).toContain("ship it");
  });

  it("throws when there is no Plan artifact for the run", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});
