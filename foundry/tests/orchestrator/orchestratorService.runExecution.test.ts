import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
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
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
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
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts", "src/bar.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: ["Added a helper"],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation.",
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

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: RunEvent.EXECUTION_STARTED as string,
    source: "orchestrator",
    payloadJson: {},
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
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["protected/"],
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
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
    linearClient,
    githubClient,
    gitService,
    executorAgent,
    reviewerAgent,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runExecution("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("throws PolicyViolationError when run is not in Implementing state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws PolicyViolationError when approvedPlanVersion doesn't match the plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ approvedPlanVersion: 1 }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 2 }) }),
    );

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("execute_plan_version_mismatch");
  });

  it("happy path: runs the executor, persists prNumber, transitions to AIReview via runReview, posts the execution report comment", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent, linearClient, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, prNumber: null, branchName: "ai/run-1" });
    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const readyRun = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 });

    runRepo.findById.mockResolvedValueOnce(implementingRun).mockResolvedValue(aiReviewRun);
    runRepo.update
      .mockResolvedValueOnce({ ...implementingRun, prNumber: 7, executorRuntime: "claude-code" })
      .mockResolvedValueOnce(makeRun({ reviewerRuntime: "codex", state: RunState.AIReview, prNumber: 7 }));
    runRepo.updateState
      .mockResolvedValueOnce(aiReviewRun) // EXECUTION_FINISHED
      .mockResolvedValueOnce(readyRun); // REVIEW_APPROVED

    const plan = makePlan();
    const report = makeExecutionReport();
    const review = { reviewId: "rev-1", overallVerdict: "approved" as const, summary: "Looks good", findings: [] };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      // Simulates the real ReviewerAgent persisting its own Review artifact, which
      // markReady's policy check reads back.
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });

    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });
    reviewerAgent.run.mockResolvedValue(review);

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.EXECUTION_STARTED }),
    );
    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      undefined,
    );
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { prNumber: 7, executorRuntime: "claude-code" });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does not touch git when the run has no branchName yet", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, branchName: null, prNumber: null });
    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 9 });
    const readyRun = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 9 });

    runRepo.findById.mockResolvedValueOnce(implementingRun).mockResolvedValue(aiReviewRun);
    runRepo.update
      .mockResolvedValueOnce({ ...implementingRun, prNumber: 9 })
      .mockResolvedValueOnce({ ...aiReviewRun, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValueOnce(aiReviewRun).mockResolvedValueOnce(readyRun);

    const plan = makePlan();
    const report = makeExecutionReport();
    const review = { reviewId: "rev-1", overallVerdict: "approved" as const, summary: "ok", findings: [] };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 9 });
    reviewerAgent.run.mockResolvedValue(review);

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("passes an operatorNote through to the executor agent when opts.note is set", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, branchName: null, prNumber: null });
    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 3 });
    runRepo.findById.mockResolvedValueOnce(implementingRun).mockResolvedValue(aiReviewRun);
    runRepo.update
      .mockResolvedValueOnce({ ...implementingRun, prNumber: 3 })
      .mockResolvedValueOnce({ ...aiReviewRun, reviewerRuntime: "codex" });
    runRepo.updateState
      .mockResolvedValueOnce(aiReviewRun)
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 3 }));

    const plan = makePlan();
    const report = makeExecutionReport();
    const review = { reviewId: "rev-1", overallVerdict: "approved" as const, summary: "ok", findings: [] };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 3 });
    reviewerAgent.run.mockResolvedValue(review);

    await svc.runExecution("run-1", { note: "Focus on perf" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "Focus on perf" },
    );
  });

  it("recovers a stranded execution (ExecutionReport exists, EXECUTION_FINISHED never recorded) by skipping the executor and chaining to runReview", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, prNumber: 11 });
    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 11 });
    runRepo.findById.mockResolvedValueOnce(implementingRun).mockResolvedValue(aiReviewRun);
    runRepo.update.mockResolvedValue({ ...aiReviewRun, reviewerRuntime: "codex" });
    runRepo.updateState
      .mockResolvedValueOnce(aiReviewRun) // EXECUTION_FINISHED (recovered)
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 11 })); // REVIEW_APPROVED

    const plan = makePlan();
    const report = makeExecutionReport();
    const review = { reviewId: "rev-1", overallVerdict: "approved" as const, summary: "ok", findings: [] };
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      payloadJson: report,
      createdAt: new Date("2026-01-01T00:05:00Z"),
    });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });

    // EXECUTION_STARTED fired before the report, no EXECUTION_FINISHED ever recorded.
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({
        eventType: RunEvent.EXECUTION_STARTED as string,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ]);

    reviewerAgent.run.mockResolvedValue(review);

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", prNumber: 11 }),
      expect.stringContaining("Recovered stranded execution"),
    );
    const finishedCall = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(finishedCall?.[0]).toMatchObject({ payloadJson: expect.objectContaining({ recovered: true }) });
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does NOT take the recovery shortcut when EXECUTION_FINISHED already fired after the report", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, prNumber: 11, branchName: null });
    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 13 });
    runRepo.findById.mockResolvedValueOnce(implementingRun).mockResolvedValue(aiReviewRun);
    runRepo.update
      .mockResolvedValueOnce({ ...implementingRun, prNumber: 13 })
      .mockResolvedValueOnce({ ...aiReviewRun, reviewerRuntime: "codex" });
    runRepo.updateState
      .mockResolvedValueOnce(aiReviewRun)
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 13 }));

    const plan = makePlan();
    const oldReport = makeExecutionReport({ executionVersion: 1 });
    const newReport = makeExecutionReport({ executionVersion: 2 });
    const review = { reviewId: "rev-1", overallVerdict: "approved" as const, summary: "ok", findings: [] };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: oldReport, createdAt: new Date("2026-01-01T00:00:00Z") }),
        );
      }
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });

    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_STARTED as string, createdAt: new Date("2025-12-31T23:00:00Z") }),
      makeEvent({ eventType: RunEvent.EXECUTION_FINISHED as string, createdAt: new Date("2026-01-01T00:10:00Z") }),
    ]);

    executorAgent.run.mockResolvedValue({ report: newReport, prNumber: 13 });
    reviewerAgent.run.mockResolvedValue(review);

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("throws PolicyViolationError when the executor touches a protected path", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, branchName: null, prNumber: null });
    runRepo.findById.mockResolvedValue(implementingRun);
    runRepo.update.mockResolvedValue({ ...implementingRun, prNumber: 20 });

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    const badReport = makeExecutionReport({ filesChanged: ["protected/secret.ts"] });
    executorAgent.run.mockResolvedValue({ report: badReport, prNumber: 20 });

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("executor_touched_protected_path");
  });

  it("throws PolicyViolationError when the executor exceeds maxFilesChanged", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, branchName: null, prNumber: null });
    runRepo.findById.mockResolvedValue(implementingRun);
    runRepo.update.mockResolvedValue({ ...implementingRun, prNumber: 21 });

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    const tooManyFiles = Array.from({ length: 11 }, (_, i) => `src/file${i}.ts`);
    const badReport = makeExecutionReport({ filesChanged: tooManyFiles });
    executorAgent.run.mockResolvedValue({ report: badReport, prNumber: 21 });

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("executor_exceeded_max_files");
  });

  it("on AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a timeout comment, and returns without rethrowing", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, branchName: null, prNumber: null });
    const blockedRun = makeRun({ state: RunState.AIBlocked });
    runRepo.findById.mockResolvedValue(implementingRun);
    runRepo.updateState.mockResolvedValue(blockedRun);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    const timeoutEventCall = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEventCall?.[0]).toMatchObject({
      payloadJson: expect.objectContaining({ agent: "executor", timeoutMs: 1_800_000 }),
    });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out after 30 minutes"),
    );
  });

  it("rethrows a non-timeout error from the executor agent", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, branchName: null, prNumber: null });
    runRepo.findById.mockResolvedValue(implementingRun);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });
});
