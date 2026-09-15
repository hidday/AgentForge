import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
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
    state: RunState.Todo,
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
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Some findings",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "risk",
        title: "Missing edge case",
        details: "Consider X",
      },
    ],
    overallVerdict: "changes_requested",
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
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "hidday/lin-1-test",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff"),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
      distillationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    distillationAgent,
    gitService,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.startRun early return", () => {
  it("returns the existing active run without creating a new one", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const activeRun = makeRun({ state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(activeRun);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans using prior artifacts and proceeds to plan review with no blockers", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    const revisedPlan = makePlan({ planVersion: 2, openQuestions: [] });

    runRepo.findById.mockResolvedValueOnce(planningRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

    const previousPlan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      if (type === "RejectionContext")
        return Promise.resolve(
          makeArtifact({
            type: "RejectionContext",
            payloadJson: { planVersion: 1, feedback: "fix it", source: "api", mode: "iterate" },
          }),
        );
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{ questionId: "q1", answer: "a" }] } }),
        );
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({
            type: "PlanReview",
            payloadJson: { summary: "s", findings: [] },
          }),
        );
      return Promise.resolve(null);
    });

    plannerAgent.run.mockResolvedValue(revisedPlan);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan,
        humanFeedback: { planVersion: 1, feedback: "fix it" },
        humanAnswers: [{ questionId: "q1", answer: "a" }],
        planReviewFindings: { summary: "s", findings: [] },
      }),
    );
    expect(planReviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 });

    runRepo.findById.mockResolvedValue(planningRun);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(clarificationRun);
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

    artifactRepo.findLatestByType.mockResolvedValue(null);

    const stillBlocked = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(stillBlocked);

    const result = await svc.runPlanning("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName", async () => {
    const { deps, runRepo, gitService, plannerAgent, planReviewerAgent, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo, branchName: null });
    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan({ openQuestions: [] });

    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // RUN_REQUESTED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED
    // First update() call: worktree setup (state still Todo at that point).
    // Second update() call: planVersion update (state must already be Planning).
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, branchName: "ai/run-1", workingDirectory: "/tmp/worktree" })
      .mockResolvedValueOnce({ ...planningRun, planVersion: 1 });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledTimes(1);
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ branchName: "ai/run-1" }),
    );
    expect(result).toBeDefined();
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const { deps, runRepo, gitService, plannerAgent, planReviewerAgent, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo, branchName: "ai/existing" });
    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const plan = makePlan({ openQuestions: [] });

    runRepo.findById.mockResolvedValueOnce(todoRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    // Only one update() call in this path: the planVersion update after planning.
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 1 });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(plan);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("routes to runPlanRevision when the plan reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const planRevisionRun = makeRun({ state: RunState.PlanRevision });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });

    runRepo.findById.mockResolvedValueOnce(planReviewRun).mockResolvedValue(planRevisionRun);
    runRepo.updateState
      .mockResolvedValueOnce(planRevisionRun) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVISED
    runRepo.update.mockResolvedValue({ ...planRevisionRun, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: makePlanReview() }));
      return Promise.resolve(null);
    });

    planReviewerAgent.run.mockResolvedValue(makePlanReview());
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "good catch" }],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runPlanReview("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan Revision Dispositions"),
    );
    expect(result).toBeDefined();
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts a note-aware comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 3 });
    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });
    const implementingRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });

    runRepo.findById.mockResolvedValue(awaitingRun);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));
    runRepo.update.mockResolvedValue({ ...awaitingRun, approvedPlanVersion: 3 });
    runRepo.updateState.mockResolvedValue(implementingRun);

    const result = await svc.approvePlan("run-1", { note: "go ahead" });

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("with operator note"),
    );
    expect(result.state).toBe(RunState.Implementing);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const planReviewRun = makeRun({ state: RunState.PlanReview });

    runRepo.findById.mockResolvedValueOnce(awaitingRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(awaitingRun); // PLAN_REVIEW_APPROVED
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    const result = await svc.runManualReReview("run-1", { note: "double check" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check" },
    );
    expect(result).toBeDefined();
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const planReviewRun = makeRun({ state: RunState.PlanReview });

    runRepo.findById.mockResolvedValueOnce(awaitingRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(awaitingRun); // PLAN_REVIEW_APPROVED (forced, per method contract)
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const result = await svc.runManualReReview("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.PlanReview);
    expect(runRepo.updateState).toHaveBeenNthCalledWith(2, "run-1", RunState.AwaitingPlanApproval);
    expect(result).toBeDefined();
  });

  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("no revision needed when reviewer approves", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const planReviewRun = makeRun({ state: RunState.PlanReview });

    runRepo.findById.mockResolvedValueOnce(awaitingRun).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(awaitingRun); // PLAN_REVIEW_APPROVED
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    const result = await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("routes to runPlanRevision (with the operator note) when reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const planRevisionRun = makeRun({ state: RunState.PlanRevision });

    runRepo.findById
      .mockResolvedValueOnce(awaitingRun) // requireRun in runManualPlanRevision
      .mockResolvedValue(planRevisionRun); // requireRun inside runPlanRevision
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(planRevisionRun) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(awaitingRun); // PLAN_REVISED
    // runPlanRevision updates planVersion on the (still PlanRevision-state) run
    // before transitioning it via PLAN_REVISED.
    runRepo.update.mockResolvedValue({ ...planRevisionRun, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: makePlanReview() }));
      return Promise.resolve(null);
    });

    planReviewerAgent.run.mockResolvedValue(makePlanReview());
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runManualPlanRevision("run-1", { note: "please tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please tighten scope" },
    );
    expect(linearClient.postComment).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the final comment", async () => {
    const { deps, runRepo, distillationAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    const doneRun = makeRun({ state: RunState.Done });

    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(doneRun);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", readyRun);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("ignores distillation failures (best-effort) and still completes the run", async () => {
    const { deps, runRepo, distillationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    const doneRun = makeRun({ state: RunState.Done });

    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(doneRun);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "string" && (call[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("distillation blew up");
  });

  it("works fine when no distillationAgent dependency is configured", async () => {
    const { deps, runRepo } = buildDeps({ distillationAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    const doneRun = makeRun({ state: RunState.Done });

    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(doneRun);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
