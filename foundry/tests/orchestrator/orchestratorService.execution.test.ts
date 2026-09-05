import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
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
    summary: "Did the thing",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: ["A note"],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid",
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
    eventType: "EXECUTION_STARTED",
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
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff") };

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
    executorAgent,
    reviewerAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("commits a WIP checkpoint, runs the executor, and proceeds to code review on success", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const report = makeExecutionReport();

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing })) // requireRun in runExecution
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 7 })) // requireRun in runReview
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 })); // requireRun in markReady
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") {
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      }
      if (type === "Review") {
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "Fine", overallVerdict: "approved", findings: [] },
          }),
        );
      }
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 7 })) // prNumber update
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 7, reviewerRuntime: "codex" })); // reviewerRuntime update in runReview
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 7 })) // EXECUTION_FINISHED
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 })); // REVIEW_APPROVED

    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "Fine",
      overallVerdict: "approved",
      findings: [],
    });

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );
    expect(executorAgent.run).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("throws PolicyViolationError from assertCanExecute when the run is not Implementing", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runExecution("run-1")).rejects.toThrow(/Cannot execute/);
  });

  it("recovers a stranded execution: skips re-running the executor when an ExecutionReport already exists without EXECUTION_FINISHED", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const report = makeExecutionReport();
    const reportCreatedAt = new Date("2026-01-02T00:00:00Z");
    const startedAt = new Date("2026-01-01T00:00:00Z"); // before the report

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 9 })) // requireRun in runExecution
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 9 })) // requireRun in runReview
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 9 })); // requireRun in markReady
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: report, createdAt: reportCreatedAt }),
        );
      }
      if (type === "Review") {
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "Fine", overallVerdict: "approved", findings: [] },
          }),
        );
      }
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: startedAt }),
    ]);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 9 })) // EXECUTION_FINISHED (recovered)
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 9 })); // REVIEW_APPROVED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 9, reviewerRuntime: "codex" }));
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "Fine",
      overallVerdict: "approved",
      findings: [],
    });

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.EXECUTION_FINISHED }),
    );
    expect(result).toBeDefined();
  });

  it("does NOT recover when EXECUTION_FINISHED was already recorded after the report (re-runs executor)", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const report = makeExecutionReport();
    const reportCreatedAt = new Date("2026-01-01T00:00:00Z");
    const finishedAt = new Date("2026-01-02T00:00:00Z"); // after the report -> already finished properly

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 9 })) // requireRun in runExecution
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 9 })) // requireRun in runReview
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 9 })); // requireRun in markReady
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: report, createdAt: reportCreatedAt }),
        );
      }
      if (type === "Review") {
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "Fine", overallVerdict: "approved", findings: [] },
          }),
        );
      }
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_FINISHED, createdAt: finishedAt }),
    ]);
    executorAgent.run.mockResolvedValue({ report, prNumber: 9 });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 9 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 9, reviewerRuntime: "codex" }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 9 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 9 }));
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "Fine",
      overallVerdict: "approved",
      findings: [],
    });

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalled();
  });

  it("skips the WIP checkpoint commit when the run has no branchName", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const report = makeExecutionReport();

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, branchName: null })) // requireRun in runExecution
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, branchName: null, prNumber: 3 })) // requireRun in runReview
      .mockResolvedValueOnce(
        makeRun({ state: RunState.ReadyForHumanReview, branchName: null, prNumber: 3 }),
      ); // requireRun in markReady
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") {
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: report }));
      }
      if (type === "Review") {
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: { reviewId: "rev-1", summary: "Fine", overallVerdict: "approved", findings: [] },
          }),
        );
      }
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 3 });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, branchName: null, prNumber: 3 }))
      .mockResolvedValueOnce(
        makeRun({ state: RunState.AIReview, branchName: null, prNumber: 3, reviewerRuntime: "codex" }),
      );
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, branchName: null, prNumber: 3 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, branchName: null, prNumber: 3 }));
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "Fine",
      overallVerdict: "approved",
      findings: [],
    });

    await svc.runExecution("run-1");

    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("on AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to Blocked, and posts a comment (does not rethrow)", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));
    runRepo.updateState.mockResolvedValueOnce(makeRun({ state: RunState.AIBlocked }));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "EXECUTION_TIMEOUT",
        payloadJson: expect.objectContaining({ agent: "executor", timeoutMs: 1_800_000 }),
      }),
    );
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("timed out"),
    );
    expect(comment).toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("rethrows non-timeout errors from the executor", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    const boom = new Error("executor crashed");
    executorAgent.run.mockRejectedValue(boom);

    await expect(svc.runExecution("run-1")).rejects.toThrow("executor crashed");
  });

  it("throws PolicyViolationError when the executor touches a protected path", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const report = makeExecutionReport({ filesChanged: ["secrets/keys.txt"] });

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
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
    executorAgent.run.mockResolvedValue({ report, prNumber: 4 });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 4 }));

    await expect(svc.runExecution("run-1")).rejects.toThrow(/protected path/);
  });
});
