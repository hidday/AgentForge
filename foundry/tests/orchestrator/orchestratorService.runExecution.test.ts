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

function makePlan(): Plan {
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
    score: 0.95,
    scoreRationale: "All checks green.",
    ...overrides,
  };
}

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

function makeEvent(overrides: Partial<RunEventRecord> & { eventType: string }): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
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

  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined), getRelatedContext: vi.fn() };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
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
    linearClient,
    executorAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("runs the executor normally when no ExecutionReport artifact exists yet", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, gitService, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 55, executorRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "ExecutionReport") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    });

    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 55 });

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    const startedCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_STARTED,
    );
    expect(startedCall).toBeDefined();
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { prNumber: 55, executorRuntime: "claude-code" });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBeDefined();
  });

  it("forwards an operator note to the executor agent", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 55, executorRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact("Plan", 1, makePlan())) : Promise.resolve(null),
    );
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    });
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 55 });

    await svc.runExecution("run-1", { note: "focus on the race condition" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      makePlan(),
      expect.anything(),
      "run-1",
      expect.objectContaining({ existingBranch: "ai/run-1" }),
      { operatorNote: "focus on the race condition" },
    );
  });

  it("skips the git checkpoint commit when the run has no branchName", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, gitService, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ branchName: null, prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 1, executorRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    });
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 1 });

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("recovers a stranded execution: skips the executor and transitions straight to review when ExecutionReport exists with no matching EXECUTION_FINISHED", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ prNumber: 77 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
    const lastStarted = makeEvent({
      id: "e1",
      eventType: RunEvent.EXECUTION_STARTED,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    eventRepo.findByRunId.mockResolvedValue([lastStarted]);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "ExecutionReport") {
        return Promise.resolve({ ...asArtifact("ExecutionReport", 1, makeExecutionReport()), createdAt: reportCreatedAt });
      }
      return Promise.resolve(null);
    });

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    const recoveredCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(recoveredCall).toBeDefined();
    expect((recoveredCall![0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", prNumber: 77 }),
      expect.stringContaining("Recovered stranded execution"),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBeDefined();
  });

  it("does NOT recover (re-runs the executor) when EXECUTION_FINISHED already followed the report", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ prNumber: 77 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 77, executorRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
    const lastStarted = makeEvent({
      id: "e1",
      eventType: RunEvent.EXECUTION_STARTED,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const lastFinished = makeEvent({
      id: "e2",
      eventType: RunEvent.EXECUTION_FINISHED,
      createdAt: new Date("2026-01-01T00:10:00Z"),
    });
    eventRepo.findByRunId.mockResolvedValue([lastStarted, lastFinished]);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "ExecutionReport") {
        return Promise.resolve({ ...asArtifact("ExecutionReport", 1, makeExecutionReport()), createdAt: reportCreatedAt });
      }
      return Promise.resolve(null);
    });
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    });
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 77 });

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("does NOT attempt recovery when the run has no prNumber yet, even if an ExecutionReport exists", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 9, executorRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      return Promise.resolve(null);
    });
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    });
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 9 });

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("handles AgentTimeoutError: logs, records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and does not call runReview", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    const run = makeRun({ prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    });

    const timeoutError = new AgentTimeoutError("executor", 600_000);
    executorAgent.run.mockRejectedValue(timeoutError);

    const result = await svc.runExecution("run-1");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", timeoutMs: 600_000, agent: "executor" }),
      "Executor agent timed out",
    );
    const timeoutEventCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEventCall).toBeDefined();
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out after 10 minutes"),
    );
    expect(runReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AIBlocked);
  });

  it("re-throws non-timeout errors from the executor without catching them", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: null });
    runRepo.findById.mockResolvedValue(run);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });
    linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    });

    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });
});
