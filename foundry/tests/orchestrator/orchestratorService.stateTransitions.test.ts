import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError, AgentTimeoutError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Did the thing",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid",
    ...overrides,
  };
}

function makeArtifact<T>(type: Artifact["type"], payload: T, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `artifact-${type}`,
    runId: "run-1",
    type,
    version: 1,
    payloadJson: payload as unknown,
    rawText: JSON.stringify(payload),
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "SOME_EVENT",
    source: "test",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

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
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      url: "https://linear.app/x",
      branchName: "ai/lin-1",
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
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/repos/test-repo"),
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
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    linearClient,
    githubClient,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    executorAgent,
    gitService,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const existing = makeRun({ id: "existing-run", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
  });

  it("creates a run, sets up the worktree, plans, and proceeds to plan review when there are no blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, gitService, dashboardEmitter, linearClient } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const created = makeRun({ id: "run-1", state: RunState.Todo });
    const afterWorktree = makeRun({
      id: "run-1",
      state: RunState.Todo,
      workingDirectory: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    const afterRunRequested = makeRun({
      id: "run-1",
      state: RunState.Planning,
      workingDirectory: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    const afterPlannerUpdate = makeRun({
      id: "run-1",
      state: RunState.Planning,
      planVersion: 2,
      plannerRuntime: "claude-code",
      workingDirectory: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    const afterPlanCreated = makeRun({
      id: "run-1",
      state: RunState.PlanReview,
      planVersion: 2,
      workingDirectory: "/tmp/worktree",
      branchName: "ai/run-1",
    });

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(created);
    runRepo.update.mockResolvedValueOnce(afterWorktree).mockResolvedValueOnce(afterPlannerUpdate);
    runRepo.updateState.mockResolvedValueOnce(afterRunRequested).mockResolvedValueOnce(afterPlanCreated);

    const plan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(plan);

    const finalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(finalRun);

    const result = await svc.startRun("LIN-1");

    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueId: "LIN-1",
        linearIssueIdentifier: "LIN-1",
        repo: "test-repo",
      }),
    );
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining('AI planning started for "Test issue"'),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ issue: expect.objectContaining({ id: "LIN-1" }) }),
      "run-1",
      { priorSkills: [] },
    );
    expect(artifactRepo.create).toHaveBeenCalledWith(expect.objectContaining({ type: "TaskBundle" }));
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(finalRun);
  });

  it("pauses for human clarification when the plan has blocking open questions", async () => {
    const { deps, runRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const created = makeRun({ id: "run-1", state: RunState.Todo });
    const afterWorktree = makeRun({ id: "run-1", state: RunState.Todo });
    const afterRunRequested = makeRun({ id: "run-1", state: RunState.Planning });
    const afterPlannerUpdate = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 });
    const afterPlanCreated = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 });
    const afterClarification = makeRun({
      id: "run-1",
      state: RunState.HumanClarificationNeeded,
      planVersion: 2,
    });

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(created);
    runRepo.update.mockResolvedValueOnce(afterWorktree).mockResolvedValueOnce(afterPlannerUpdate);
    runRepo.updateState
      .mockResolvedValueOnce(afterRunRequested)
      .mockResolvedValueOnce(afterPlanCreated)
      .mockResolvedValueOnce(afterClarification);

    const plan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(plan);

    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.startRun("LIN-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("propagates a PolicyViolationError from assertCanPlan without recording any transition", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const created = makeRun({ id: "run-1", state: RunState.Todo });
    const afterWorktree = makeRun({ id: "run-1", state: RunState.AIBlocked });

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(created);
    runRepo.update.mockResolvedValueOnce(afterWorktree);

    await expect(svc.startRun("LIN-1")).rejects.toThrow(PolicyViolationError);
    expect(runRepo.updateState).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("throws when the run cannot be found", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("re-plans with all prior context artifacts injected and proceeds to plan review", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 });
    runRepo.findById.mockResolvedValue(run);

    const previousPlan = makePlan({ planVersion: 2 });
    const rejectionContext = {
      planVersion: 2,
      feedback: "too risky",
      source: "api" as const,
      mode: "iterate" as const,
    };
    const humanAnswers = [{ questionId: "q1", answer: "yes" }];
    const researchedAnswers = [
      { questionId: "q1", question: "Q?", answer: "A", confidence: "high" as const },
    ];
    const planReview = {
      summary: "review summary",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext") return Promise.resolve(makeArtifact("RejectionContext", rejectionContext));
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", previousPlan));
      if (type === "HumanAnswers") return Promise.resolve(makeArtifact("HumanAnswers", { answers: humanAnswers }));
      if (type === "ResearchedAnswers")
        return Promise.resolve(makeArtifact("ResearchedAnswers", { answers: researchedAnswers }));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", planReview));
      if (type === "TaskBundle") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);

    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Planning, planVersion: 3 }));
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 3 }));

    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ id: "run-1", state: RunState.PlanReview }));

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ issue: expect.anything() }),
      "run-1",
      {
        planVersionOverride: 3,
        previousPlan,
        humanFeedback: { planVersion: 2, feedback: "too risky" },
        humanAnswers,
        researchedAnswers,
        planReviewFindings: planReview,
      },
    );
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("re-plans with no prior context when no artifacts exist, and pauses on blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(
        makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 2 }),
      );

    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(expect.anything(), "run-1", { planVersionOverride: 2 });
    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("throws when the run cannot be found", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.retryRun("missing")).rejects.toThrow("Run not found: missing");
  });

  it("sets up a fresh worktree when the run has no branchName", async () => {
    const { deps, runRepo, gitService, repoRegistry, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, workingDirectory: "/main" });
    runRepo.findById.mockResolvedValue(run);

    const afterWorktree = makeRun({
      id: "run-1",
      state: RunState.Todo,
      workingDirectory: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    runRepo.update.mockResolvedValueOnce(afterWorktree).mockResolvedValue(
      makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 }),
    );
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 }));

    const plan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(plan);

    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ id: "run-1", state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.resolveMainRepoPath).toHaveBeenCalledWith("/main");
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith("/tmp", "run-1", "main", "ai/lin-1");
    expect(repoRegistry.getRepoByName).toHaveBeenCalledWith("test-repo");
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const { deps, runRepo, gitService, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 }));

    const plan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(plan);

    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.PlanReview }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for clarification when the re-plan still has blocking questions", async () => {
    const { deps, runRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(
        makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 2 }),
      );

    const plan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(plan);

    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.retryRun("run-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts a plain comment without a note", async () => {
    const { deps, runRepo, artifactRepo, linearClient, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan({ planVersion: 4 });
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact("Plan", plan));

    const withApproval = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 4 });
    runRepo.update.mockResolvedValue(withApproval);
    const implementing = makeRun({ state: RunState.Implementing, approvedPlanVersion: 4 });
    runRepo.updateState.mockResolvedValue(implementing);

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 4 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v4 approved. Starting implementation...",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ hasOperatorNote: false }),
      "Plan approved",
    );
    expect(result).toBe(implementing);
  });

  it("includes the operator note in the comment and the transition payload", async () => {
    const { deps, runRepo, artifactRepo, linearClient, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact("Plan", plan));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 }));

    await svc.approvePlan("run-1", { note: "skip the migration step" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("skip the migration step"),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ payloadJson: expect.objectContaining({ note: "skip the migration step" }) }),
    );
  });
});

describe("OrchestratorService.runExecution", () => {
  it("throws PolicyViolationError and does not invoke the executor when run is not Implementing", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact("Plan", makePlan()));

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    expect(executorAgent.run).not.toHaveBeenCalled();
  });

  it("recovers a stranded execution: skips the executor and jumps straight to review", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      prNumber: 42,
    });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    const reportArtifact = makeArtifact("ExecutionReport", report, { createdAt: new Date("2026-01-01T00:10:00Z") });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });

    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: new Date("2026-01-01T00:00:00Z") }),
    ]);

    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));

    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: RunEvent.EXECUTION_FINISHED,
        payloadJson: expect.objectContaining({ recovered: true }),
      }),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("does not recover (runs the executor normally) when EXECUTION_FINISHED was already recorded after the report", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      prNumber: 42,
      branchName: null,
    });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    const reportArtifact = makeArtifact("ExecutionReport", report, { createdAt: new Date("2026-01-01T00:05:00Z") });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });

    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: new Date("2026-01-01T00:00:00Z") }),
      makeEvent({ eventType: RunEvent.EXECUTION_FINISHED, createdAt: new Date("2026-01-01T00:10:00Z") }),
    ]);

    executorAgent.run.mockResolvedValue({ report, prNumber: 42 });
    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Implementing, prNumber: 42 }));
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));

    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalled();
  });

  it("commits a WIP checkpoint when the run has a branchName", async () => {
    const { deps, runRepo, artifactRepo, gitService, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      workingDirectory: "/tmp/worktree",
    });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );

    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });
    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Implementing, prNumber: 7 }));
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
  });

  it("skips the WIP checkpoint when the run has no branchName", async () => {
    const { deps, runRepo, artifactRepo, gitService, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );

    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });
    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Implementing, prNumber: 7 }));
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("handles an executor timeout: blocks the run and posts a timeout comment instead of throwing", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );

    const timeoutErr = new AgentTimeoutError("executor", 600_000);
    executorAgent.run.mockRejectedValue(timeoutErr);

    const blockedRun = makeRun({ id: "run-1", state: RunState.AIBlocked });
    runRepo.updateState.mockResolvedValue(blockedRun);

    const runReviewSpy = vi.spyOn(svc, "runReview");

    const result = await svc.runExecution("run-1");

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "EXECUTION_TIMEOUT",
        payloadJson: { agent: "executor", timeoutMs: 600_000 },
      }),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out after 10 minutes"),
    );
    expect(runReviewSpy).not.toHaveBeenCalled();
    expect(result).toBe(blockedRun);
  });

  it("rethrows a non-timeout error from the executor", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );

    const boom = new Error("boom");
    executorAgent.run.mockRejectedValue(boom);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("on success: updates prNumber, enforces executor path policy, transitions to AIReview, and starts review", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );

    const report = makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 99 });

    const afterUpdate = makeRun({ id: "run-1", state: RunState.Implementing, prNumber: 99 });
    runRepo.update.mockResolvedValue(afterUpdate);
    const afterFinished = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 99 });
    runRepo.updateState.mockResolvedValue(afterFinished);

    const finalRun = makeRun({ state: RunState.AIReview });
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(finalRun);

    const result = await svc.runExecution("run-1", { note: "be careful" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { existingBranch: null, existingPR: null },
      { operatorNote: "be careful" },
    );
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { prNumber: 99, executorRuntime: "claude-code" });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(finalRun);
  });

  it("propagates a PolicyViolationError when the executor exceeds the max files changed constraint", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );

    // defaultRepoEntry.constraints.maxFilesChanged is 10
    const tooManyFiles = Array.from({ length: 11 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: tooManyFiles });
    executorAgent.run.mockResolvedValue({ report, prNumber: 1 });
    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Implementing, prNumber: 1 }));

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });
});
