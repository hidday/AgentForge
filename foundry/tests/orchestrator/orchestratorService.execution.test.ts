import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";

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
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.85,
    scoreRationale: "solid",
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
    id: "evt-1",
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
    update: vi.fn(),
    updateState: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      return Promise.resolve(null);
    }),
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
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };

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
    postExecutionReportUpdate: vi.fn(),
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    executorAgent,
    reviewerAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws PolicyViolationError when the run is not in Implementing state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Planning }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    const err = await svc.runExecution("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
  });

  it("throws PolicyViolationError when the plan version doesn't match approvedPlanVersion", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }),
    );
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 1 }) })) : null,
    );

    const svc = new OrchestratorService(deps as never);
    const err = await svc.runExecution("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
  });

  it("commits a WIP checkpoint when run.branchName is set, then runs the executor and proceeds to review", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, gitService, executorAgent, reviewerAgent, linearClient } =
      buildDeps();
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    runRepo.findById
      .mockResolvedValueOnce(run) // runExecution's requireRun
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 55 })); // runReview's requireRun
    const report = makeExecutionReport();
    let executionReportCalls = 0;
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "ExecutionReport") {
        executionReportCalls += 1;
        // 1st call: runExecution's stranded-execution check (before the executor ran).
        // 2nd+ call: runReview's assertCanReview, after the executor "persisted" its report.
        return Promise.resolve(
          executionReportCalls === 1
            ? null
            : makeArtifact({ type: "ExecutionReport", payloadJson: report }),
        );
      }
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "fine", findings: [], overallVerdict: "approved" },
          }),
        );
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 55 });
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 55 })) // after executor
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 55 })); // runReview's reviewerRuntime update
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 55 })) // EXECUTION_FINISHED
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 55 })); // REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.anything(),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      undefined,
    );
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips the WIP checkpoint when run.branchName is not set", async () => {
    const { deps, runRepo, artifactRepo, gitService, executorAgent, reviewerAgent } = buildDeps();
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, branchName: null }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 1 }));
    let execReportCalls1 = 0;
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "ExecutionReport") {
        execReportCalls1 += 1;
        return Promise.resolve(
          execReportCalls1 === 1
            ? null
            : makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
        );
      }
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "fine", findings: [], overallVerdict: "approved" },
          }),
        );
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 1 });
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 1 })) // after executor
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 1 })); // runReview's reviewerRuntime update
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 1 })) // EXECUTION_FINISHED
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 1 })); // REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("passes operatorNote through to the executor agent", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent } = buildDeps();
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, branchName: null }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 1 }));
    let execReportCalls2 = 0;
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "ExecutionReport") {
        execReportCalls2 += 1;
        return Promise.resolve(
          execReportCalls2 === 1
            ? null
            : makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
        );
      }
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "fine", findings: [], overallVerdict: "approved" },
          }),
        );
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 1 });
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 1 })) // after executor
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 1 })); // runReview's reviewerRuntime update
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 1 })) // EXECUTION_FINISHED
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 1 })); // REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1", { note: "use feature flag X" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "use feature flag X" },
    );
  });

  it("recovers a stranded execution: skips the executor and transitions directly to AIReview via EXECUTION_FINISHED(recovered)", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps();
    const run = makeRun({ state: RunState.Implementing, prNumber: 99 });
    runRepo.findById
      .mockResolvedValueOnce(run) // runExecution's requireRun
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 99 })); // runReview's requireRun

    const reportCreatedAt = new Date("2024-01-01T00:10:00Z");
    const startedAt = new Date("2024-01-01T00:00:00Z"); // before the report
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", createdAt: reportCreatedAt, payloadJson: makeExecutionReport() }),
        );
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "fine", findings: [], overallVerdict: "approved" },
          }),
        );
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: startedAt }),
      // no EXECUTION_FINISHED recorded -- this is the "stranded" condition
    ]);
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 99 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 99 })) // EXECUTION_FINISHED(recovered)
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 99 })); // REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    const finishedCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(
      (finishedCall![0] as { payloadJson: { recovered?: boolean } }).payloadJson.recovered,
    ).toBe(true);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does NOT recover (runs executor normally) when EXECUTION_FINISHED was already recorded after the report", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps();
    const run = makeRun({ state: RunState.Implementing, prNumber: 99, branchName: null });
    runRepo.findById
      .mockResolvedValueOnce(run) // runExecution's requireRun
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 99 })); // runReview's requireRun

    const reportCreatedAt = new Date("2024-01-01T00:10:00Z");
    const startedAt = new Date("2024-01-01T00:00:00Z");
    const finishedAt = new Date("2024-01-01T00:20:00Z"); // after the report -> not stranded
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", createdAt: reportCreatedAt, payloadJson: makeExecutionReport() }),
        );
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "fine", findings: [], overallVerdict: "approved" },
          }),
        );
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: startedAt }),
      makeEvent({ eventType: RunEvent.EXECUTION_FINISHED, createdAt: finishedAt }),
    ]);
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport({ executionVersion: 2 }), prNumber: 99 });
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 99 })) // after executor
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 99 })); // runReview's reviewerRuntime update
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 99 })) // EXECUTION_FINISHED
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 99 })); // REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalled();
  });

  it("on AgentTimeoutError: logs, records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and returns without reviewing", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent, linearClient, logger } =
      buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing, branchName: null }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : null,
    );
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 3_600_000));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(logger.error).toHaveBeenCalled();
    const timeoutEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out after 60 minutes"),
    );
    expect(reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("rethrows non-timeout errors from the executor agent", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing, branchName: null }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : null,
    );
    executorAgent.run.mockRejectedValue(new Error("boom"));

    const svc = new OrchestratorService(deps as never);
    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("throws PolicyViolationError when the executor touched a protected path", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing, branchName: null }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : null,
    );
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["secrets/prod.env"] }),
      prNumber: 1,
    });
    repoRegistryProtects(deps);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 1 }));

    const svc = new OrchestratorService(deps as never);
    const err = await svc.runExecution("run-1").catch((e) => e);

    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
  });
});

function repoRegistryProtects(deps: { repoRegistry: { getRepoByName: ReturnType<typeof vi.fn> } }) {
  deps.repoRegistry.getRepoByName.mockReturnValue({
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
  });
}
