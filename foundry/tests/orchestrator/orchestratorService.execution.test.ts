import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
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
    summary: "Implementation done.",
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

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test", description: "d", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp/worktree",
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

function buildDeps() {
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
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
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
    getDefaultRepo: vi.fn(),
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    executorAgent,
    gitService,
    logger,
    linearClient,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("runs the executor happy path and transitions into code review", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: null });
    const updatedRunAfterPr = makeRun({ prNumber: 101 });
    const finishedRun = makeRun({ prNumber: 101, state: RunState.AIReview });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "ExecutionReport") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue(updatedRunAfterPr);
    runRepo.updateState.mockResolvedValue(finishedRun);
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 101 });

    // Stop before the review chain — we only care that execution completes and
    // hands off correctly.
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(finishedRun);

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.anything(),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      undefined,
    );
    expect(runRepo.update).toHaveBeenCalledWith("run-1", {
      prNumber: 101,
      executorRuntime: "claude-code",
    });
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(finishedRun);
  });

  it("passes an operator note through to the executor agent when provided", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: null, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue(makeRun({ prNumber: 5 }));
    runRepo.updateState.mockResolvedValue(makeRun({ prNumber: 5, state: RunState.AIReview }));
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 5 });
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1", { note: "focus on perf" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "focus on perf" },
    );
  });

  it("throws a PolicyViolationError from assertCanExecute when the run is not Implementing", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Planning }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  describe("stranded-execution recovery", () => {
    it("skips re-running the executor and jumps to review when a report exists after the last EXECUTION_STARTED with no later EXECUTION_FINISHED", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, executorAgent, logger } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ prNumber: 55 });
      const reviewedRun = makeRun({ prNumber: 55, state: RunState.AIReview });
      runRepo.findById.mockResolvedValue(run);

      const startedAt = new Date("2026-01-01T00:00:00Z");
      const reportCreatedAt = new Date("2026-01-01T00:05:00Z");

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        if (type === "ExecutionReport") {
          return Promise.resolve(
            makeArtifact({
              type: "ExecutionReport",
              payloadJson: makeExecutionReport(),
              createdAt: reportCreatedAt,
            }),
          );
        }
        return Promise.resolve(null);
      });

      eventRepo.findByRunId.mockResolvedValue([
        makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: startedAt }),
      ]);

      runRepo.updateState.mockResolvedValue(reviewedRun);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(reviewedRun);

      const result = await svc.runExecution("run-1");

      expect(executorAgent.run).not.toHaveBeenCalled();
      expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIReview);
      const finishedEventCall = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
      );
      expect(finishedEventCall?.[0]).toMatchObject({
        payloadJson: expect.objectContaining({ recovered: true }),
      });
      expect(runReviewSpy).toHaveBeenCalledWith("run-1");
      expect(result).toBe(reviewedRun);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", prNumber: 55 }),
        expect.stringContaining("Recovered stranded execution"),
      );
    });

    it("re-runs the executor when EXECUTION_FINISHED already followed the existing report (not stranded)", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ prNumber: 55 });
      runRepo.findById.mockResolvedValue(run);

      const startedAt = new Date("2026-01-01T00:00:00Z");
      const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
      const finishedAt = new Date("2026-01-01T00:06:00Z");

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        if (type === "ExecutionReport") {
          return Promise.resolve(
            makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport(), createdAt: reportCreatedAt }),
          );
        }
        return Promise.resolve(null);
      });

      eventRepo.findByRunId.mockResolvedValue([
        makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: startedAt }),
        makeEvent({ eventType: RunEvent.EXECUTION_FINISHED, createdAt: finishedAt }),
      ]);

      runRepo.update.mockResolvedValue(makeRun({ prNumber: 55 }));
      runRepo.updateState.mockResolvedValue(makeRun({ prNumber: 55, state: RunState.AIReview }));
      executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 55 });
      vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalledTimes(1);
    });

    it("re-runs the executor when there is an ExecutionReport but no prNumber yet", async () => {
      const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ prNumber: null });
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        if (type === "ExecutionReport")
          return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
        return Promise.resolve(null);
      });
      runRepo.update.mockResolvedValue(makeRun({ prNumber: 60 }));
      runRepo.updateState.mockResolvedValue(makeRun({ prNumber: 60, state: RunState.AIReview }));
      executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 60 });
      vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("timeout handling", () => {
    it("catches AgentTimeoutError, records EXECUTION_TIMEOUT, blocks the run, posts a comment, and returns without re-throwing", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ prNumber: null, state: RunState.Implementing });
      const blockedRun = makeRun({ state: RunState.AIBlocked });
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        return Promise.resolve(null);
      });
      runRepo.updateState.mockResolvedValue(blockedRun);

      const timeoutError = new AgentTimeoutError("executor", 600_000);
      executorAgent.run.mockRejectedValue(timeoutError);

      const result = await svc.runExecution("run-1");

      expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
      const timeoutEventCall = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
      );
      expect(timeoutEventCall?.[0]).toMatchObject({
        payloadJson: { agent: "executor", timeoutMs: 600_000 },
      });
      expect(linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        expect.stringContaining("timed out"),
      );
      expect(result).toBe(blockedRun);
    });

    it("re-throws non-timeout errors from the executor", async () => {
      const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      runRepo.findById.mockResolvedValue(makeRun({ prNumber: null }));
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        return Promise.resolve(null);
      });
      executorAgent.run.mockRejectedValue(new Error("boom"));

      await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
    });
  });
});
