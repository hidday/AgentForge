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
    linearIssueIdentifier: "ENG-1",
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
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation.",
    ...overrides,
  };
}

function asArtifact(type: string, version: number, payloadJson: unknown, createdAt = new Date()): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt,
  };
}

function makeEvent(eventType: string, createdAt: Date): RunEventRecord {
  return { id: `evt-${eventType}-${createdAt.getTime()}`, runId: "run-1", eventType, source: "x", payloadJson: {}, createdAt };
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
      branchName: "ai/run-1",
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
    linearClient,
    githubClient,
    gitService,
    executorAgent,
    reviewerAgent,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("happy path: commits a WIP checkpoint, runs the executor, persists prNumber, and proceeds to review", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, gitService, executorAgent, reviewerAgent } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const report = makeExecutionReport();

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    let executionReportCallCount = 0;
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport") {
        executionReportCallCount += 1;
        if (executionReportCallCount === 1) return Promise.resolve(null);
        return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      }
      if (type === "Review")
        return Promise.resolve(
          asArtifact("Review", 1, { reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" }),
        );
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 7 }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      undefined,
    );
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { prNumber: 7, executorRuntime: "claude-code" });

    const execComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(execComment).toBeDefined();

    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    // runReview was invoked as part of the chain -> reviewer agent called.
    expect(reviewerAgent.run).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("passes the operator note through to the executor agent", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 9 }));
    let executionReportCallCount = 0;
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport") {
        executionReportCallCount += 1;
        if (executionReportCallCount === 1) return Promise.resolve(null);
        return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      }
      if (type === "Review")
        return Promise.resolve(
          asArtifact("Review", 1, { reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" }),
        );
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 9 });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 9 }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 9 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 9 }));
    reviewerAgent.run.mockResolvedValue({ reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" });

    await svc.runExecution("run-1", { note: "focus on perf" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "focus on perf" },
    );
  });

  it("skips the WIP checkpoint commit when the run has no branchName", async () => {
    const { deps, runRepo, artifactRepo, gitService, executorAgent, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, branchName: null }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 3 }));
    let executionReportCallCount = 0;
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport") {
        executionReportCallCount += 1;
        if (executionReportCallCount === 1) return Promise.resolve(null);
        return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      }
      if (type === "Review")
        return Promise.resolve(
          asArtifact("Review", 1, { reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" }),
        );
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 3 });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 3 }))
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 3 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 3 }));
    reviewerAgent.run.mockResolvedValue({ reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" });

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a timeout comment, and returns early", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
    expect(eventTypes).toContain(RunEvent.BLOCKED);

    const timeoutComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("timed out"),
    );
    expect(timeoutComment).toBeDefined();
    expect(timeoutComment![1]).toContain("30 minutes");
  });

  it("rethrows non-timeout errors from the executor agent", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("throws PolicyViolationError via assertCanExecute when the run is not Implementing", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws PolicyViolationError when the executor's filesChanged touches a protected path", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["protected/secrets.ts"] }),
      prNumber: 1,
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 1 }));

    await expect(svc.runExecution("run-1")).rejects.toThrow(/protected path/);
  });

  describe("stranded-execution recovery", () => {
    it("recovers when an ExecutionReport exists after EXECUTION_STARTED with no EXECUTION_FINISHED, skipping the executor", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const plan = makePlan();
      const report = makeExecutionReport();
      const startedAt = new Date("2026-01-01T00:00:00Z");
      const reportCreatedAt = new Date("2026-01-01T00:05:00Z");

      runRepo.findById
        .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 55 }))
        .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 55 }));
      artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
        if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
        if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report, reportCreatedAt));
        if (type === "Review")
          return Promise.resolve(
            asArtifact("Review", 1, { reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" }),
          );
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([makeEvent(RunEvent.EXECUTION_STARTED, startedAt)]);
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 55 }));
      runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 55 }));
      reviewerAgent.run.mockResolvedValue({ reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" });

      const result = await svc.runExecution("run-1");

      expect(executorAgent.run).not.toHaveBeenCalled();
      const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
      expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
      const recoveredPayload = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
      )?.[0] as { payloadJson: Record<string, unknown> };
      expect(recoveredPayload.payloadJson.recovered).toBe(true);
      expect(reviewerAgent.run).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("does NOT recover (runs the executor normally) when EXECUTION_FINISHED already fired after the report", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const plan = makePlan();
      const report = makeExecutionReport();
      const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
      const finishedAt = new Date("2026-01-01T00:06:00Z");

      runRepo.findById
        .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 55 }))
        .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 55 }));
      artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
        if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
        if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report, reportCreatedAt));
        if (type === "Review")
          return Promise.resolve(
            asArtifact("Review", 1, { reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" }),
          );
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([makeEvent(RunEvent.EXECUTION_FINISHED, finishedAt)]);
      executorAgent.run.mockResolvedValue({ report: makeExecutionReport({ executionVersion: 2 }), prNumber: 55 });
      runRepo.update
        .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 55 }))
        .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 55 }));
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 55 }));
      reviewerAgent.run.mockResolvedValue({ reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" });

      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalled();
    });

    it("does NOT recover when there is no prNumber yet (even if an ExecutionReport exists)", async () => {
      const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const plan = makePlan();
      const report = makeExecutionReport();

      runRepo.findById
        .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: null }))
        .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 101 }));
      artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
        if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
        if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
        if (type === "Review")
          return Promise.resolve(
            asArtifact("Review", 1, { reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" }),
          );
        return Promise.resolve(null);
      });
      executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 101 });
      runRepo.update
        .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 101 }))
        .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 101 }));
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 101 }));
      reviewerAgent.run.mockResolvedValue({ reviewId: "r", summary: "ok", findings: [], overallVerdict: "approved" });

      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalled();
    });
  });
});
