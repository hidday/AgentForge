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
    summary: "Did work",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
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
    eventType: "SOME_EVENT",
    source: "orchestrator",
    payloadJson: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/worktree",
      allowedPaths: ["src/"],
      protectedPaths: ["infra/"],
    },
    constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    definitionOfDone: [],
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
      protectedPaths: ["infra/"],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
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
  describe("crash recovery (stranded ExecutionReport)", () => {
    it("skips the executor and transitions straight to review when a report exists after EXECUTION_STARTED with no later EXECUTION_FINISHED", async () => {
      const run = makeRun({ prNumber: 7 });
      const plan = makePlan();
      const report = makeExecutionReport();

      const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
        if (type === "ExecutionReport") {
          return Promise.resolve(
            makeArtifact({ type: "ExecutionReport", payloadJson: report, createdAt: new Date("2026-01-01T00:00:10Z") }),
          );
        }
        if (type === "Review") return Promise.resolve(null);
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([
        makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: new Date("2026-01-01T00:00:00Z") }),
      ]);
      runRepo.updateState.mockResolvedValue(makeRun({ prNumber: 7, state: RunState.AIReview }));

      const svc = new OrchestratorService(deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

      await svc.runExecution("run-1");

      expect(executorAgent.run).not.toHaveBeenCalled();
      expect(runReviewSpy).toHaveBeenCalledWith("run-1");

      const finishedCall = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
      );
      expect(finishedCall).toBeDefined();
      expect((finishedCall![0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered).toBe(true);
    });

    it("does NOT take the recovery path when EXECUTION_FINISHED was already recorded after the report", async () => {
      const run = makeRun({ prNumber: 7 });
      const plan = makePlan();
      const report = makeExecutionReport();

      const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient } = buildDeps();
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
        if (type === "ExecutionReport") {
          return Promise.resolve(
            makeArtifact({ type: "ExecutionReport", payloadJson: report, createdAt: new Date("2026-01-01T00:00:10Z") }),
          );
        }
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([
        makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: new Date("2026-01-01T00:00:00Z") }),
        makeEvent({ eventType: RunEvent.EXECUTION_FINISHED, createdAt: new Date("2026-01-01T00:00:20Z") }),
      ]);
      executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 7 });
      runRepo.update.mockResolvedValue(makeRun({ prNumber: 7 }));
      runRepo.updateState.mockResolvedValue(makeRun({ prNumber: 7, state: RunState.AIReview }));

      const svc = new OrchestratorService(deps as never);
      vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalledTimes(1);
      expect(linearClient.postComment).toHaveBeenCalled();
    });
  });

  describe("executor timeout", () => {
    it("records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and returns without throwing", async () => {
      const run = makeRun();
      const plan = makePlan();

      const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient, logger } = buildDeps();
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([]);
      executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runExecution("run-1");

      expect(result.state).toBe(RunState.AIBlocked);
      const timeoutEventCall = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
      );
      expect(timeoutEventCall).toBeDefined();
      expect((timeoutEventCall![0] as { payloadJson: { agent: string; timeoutMs: number } }).payloadJson).toEqual({
        agent: "executor",
        timeoutMs: 600_000,
      });

      const blockedTransitionCall = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
      );
      expect(blockedTransitionCall).toBeDefined();

      expect(linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        expect.stringContaining("Executor timed out after 10 minutes"),
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("re-throws non-timeout errors from the executor", async () => {
      const run = makeRun();
      const plan = makePlan();
      const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([]);
      executorAgent.run.mockRejectedValue(new Error("boom"));

      const svc = new OrchestratorService(deps as never);
      await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
    });
  });

  describe("protected-path policy enforcement", () => {
    it("throws PolicyViolationError when the executor reports a change to a protected path, without transitioning to AIReview", async () => {
      const run = makeRun();
      const plan = makePlan();
      const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient } = buildDeps();
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([]);
      executorAgent.run.mockResolvedValue({
        report: makeExecutionReport({ filesChanged: ["infra/secrets.yaml"] }),
        prNumber: 9,
      });
      runRepo.update.mockResolvedValue(makeRun({ prNumber: 9 }));

      const svc = new OrchestratorService(deps as never);

      await expect(svc.runExecution("run-1")).rejects.toMatchObject({
        rule: "executor_touched_protected_path",
      });

      expect(linearClient.postComment).not.toHaveBeenCalledWith(
        run.linearIssueId,
        expect.stringContaining("Execution Report"),
      );
      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  describe("happy path", () => {
    it("commits a WIP checkpoint, runs the executor, transitions to AIReview, posts the report comment, and calls runReview", async () => {
      const run = makeRun();
      const plan = makePlan();
      const report = makeExecutionReport();
      const { deps, runRepo, artifactRepo, eventRepo, executorAgent, gitService, linearClient } = buildDeps();
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([]);
      executorAgent.run.mockResolvedValue({ report, prNumber: 11 });
      runRepo.update.mockResolvedValue(makeRun({ prNumber: 11 }));
      runRepo.updateState.mockResolvedValue(makeRun({ prNumber: 11, state: RunState.AIReview }));

      const svc = new OrchestratorService(deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

      const result = await svc.runExecution("run-1");

      expect(gitService.assertBranch).toHaveBeenCalledWith(run.workingDirectory, run.branchName);
      expect(gitService.commitAndPush).toHaveBeenCalledWith(
        run.workingDirectory,
        run.branchName,
        expect.stringContaining("checkpoint before executor run"),
      );
      expect(linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        expect.stringContaining("Execution Report"),
      );
      expect(runReviewSpy).toHaveBeenCalledWith("run-1");
      expect(result.state).toBe(RunState.AIReview);
    });
  });
});
