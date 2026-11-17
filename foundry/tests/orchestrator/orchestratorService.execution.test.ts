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
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All green.",
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
    eventType: RunEvent.EXECUTION_STARTED,
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
    findLatestByType: vi.fn(),
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

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["secrets/"],
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
    executorAgent,
    gitService,
    linearClient,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws PolicyViolationError (via assertCanExecute) when run is not Implementing", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    expect(deps.executorAgent.run).not.toHaveBeenCalled();
  });

  it("recovers a stranded execution: skips the executor and transitions straight to review when a report exists without EXECUTION_FINISHED", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, prNumber: 7 });
    const report = makeExecutionReport();
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      payloadJson: report,
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });

    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      if (type === "Review") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({
        eventType: RunEvent.EXECUTION_STARTED,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ]);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));

    // reviewerAgent throws to short-circuit after confirming we reached runReview
    // without invoking the executor.
    (deps.reviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockRejectedValue(
      new Error("stop-after-recovery"),
    );

    await expect(svc.runExecution("run-1")).rejects.toThrow("stop-after-recovery");

    expect(executorAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    const recoveredCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect((recoveredCall![0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered).toBe(
      true,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", prNumber: 7 }),
      expect.stringContaining("Recovered stranded execution"),
    );
  });

  it("does NOT treat the run as stranded when EXECUTION_FINISHED already followed the report", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, prNumber: 7, branchName: null });
    const report = makeExecutionReport();
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      payloadJson: report,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({
        eventType: RunEvent.EXECUTION_STARTED,
        createdAt: new Date("2025-12-31T00:00:00Z"),
      }),
      makeEvent({
        eventType: RunEvent.EXECUTION_FINISHED,
        createdAt: new Date("2026-01-02T00:00:00Z"),
      }),
    ]);

    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ executionVersion: 2 }),
      prNumber: 7,
    });
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    (deps.reviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockRejectedValue(
      new Error("stop-after-normal-execution"),
    );

    await expect(svc.runExecution("run-1")).rejects.toThrow("stop-after-normal-execution");

    // Since EXECUTION_FINISHED already happened after the report, this is NOT
    // stranded, so the executor must run again.
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("commits a WIP checkpoint before invoking the executor when the run has a branch", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", prNumber: null });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 9 }));
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 9 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 9 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 9 }));
    (deps.reviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockRejectedValue(
      new Error("stop-after-commit-check"),
    );

    await expect(svc.runExecution("run-1")).rejects.toThrow("stop-after-commit-check");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
  });

  it("enforces executor path policy: throws when the executor touches a protected path", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["secrets/keys.json"] }),
      prNumber: 9,
    });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 9 });

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("on AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and returns without re-throwing", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient, logger } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", agent: "executor" }),
      "Executor agent timed out",
    );
  });

  it("re-throws non-timeout errors from the executor", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });
});
