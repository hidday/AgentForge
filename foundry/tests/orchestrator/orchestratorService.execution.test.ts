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
    scoreRationale: "All good",
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown; createdAt?: Date }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: overrides.createdAt ?? new Date(),
  };
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

/** Stateful dependency set: runRepo/artifactRepo/eventRepo mutate a shared
 * store so that multi-step flows (runExecution -> runReview -> markReady)
 * observe consistent state, mirroring production repo behaviour. */
function buildDeps(initialRun: Run, overrides: Record<string, unknown> = {}) {
  const store: TestStore = { run: { ...initialRun }, artifacts: [], events: [] };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact(params);
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: Omit<RunEventRecord, "id" | "createdAt">) => {
      const evt = { id: `evt-${store.events.length + 1}`, createdAt: new Date(), ...params } as RunEventRecord;
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
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
    store,
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
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws a PolicyViolationError when the run is not in the Implementing state", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);
    await artifactRepo.create({ type: "Plan", version: 1, payloadJson: makePlan() });

    const err: PolicyViolationError = await svc.runExecution("run-1").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("execute_requires_implementing_state");
  });

  it("happy path: checkpoints, runs the executor, records EXECUTION_FINISHED, and proceeds to review", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", prNumber: null });
    const { deps, artifactRepo, eventRepo, linearClient, gitService, executorAgent, reviewerAgent } =
      buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    await artifactRepo.create({ type: "Plan", version: 1, payloadJson: plan });
    const report = makeExecutionReport({ filesChanged: ["src/foo.ts"] });

    executorAgent.run.mockImplementation(async () => {
      await artifactRepo.create({ type: "ExecutionReport", version: 1, payloadJson: report });
      return { report, prNumber: 7 };
    });
    reviewerAgent.run.mockImplementation(async () => {
      const review = { reviewId: "rev-1", summary: "Looks good", findings: [], overallVerdict: "approved" };
      await artifactRepo.create({ type: "Review", version: 1, payloadJson: review });
      return review;
    });

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith(run.workingDirectory, "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      run.workingDirectory,
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
    const finishedEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(finishedEvent).toBeDefined();
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Execution Report"),
    );
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("forwards opts.note as operatorNote to the executor agent", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const { deps, artifactRepo, executorAgent, reviewerAgent } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    await artifactRepo.create({ type: "Plan", version: 1, payloadJson: plan });
    const report = makeExecutionReport();

    executorAgent.run.mockImplementation(async () => {
      await artifactRepo.create({ type: "ExecutionReport", version: 1, payloadJson: report });
      return { report, prNumber: 7 };
    });
    reviewerAgent.run.mockImplementation(async () => {
      const review = { reviewId: "rev-1", summary: "ok", findings: [], overallVerdict: "approved" };
      await artifactRepo.create({ type: "Review", version: 1, payloadJson: review });
      return review;
    });

    await svc.runExecution("run-1", { note: "Operator guidance" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "Operator guidance" },
    );
  });

  it("transitions to AIBlocked and posts a comment when the executor times out", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const { deps, artifactRepo, eventRepo, linearClient, executorAgent } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    await artifactRepo.create({ type: "Plan", version: 1, payloadJson: plan });
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    const timeoutEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Executor timed out after 10 minutes"),
    );
    const blockedEventPayload = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    )?.[0] as { payloadJson: { reason: string } };
    expect(blockedEventPayload.payloadJson.reason).toContain("Executor timed out after 10m");
  });

  it("rethrows non-timeout executor errors without transitioning the run", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const { deps, artifactRepo, executorAgent, eventRepo } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    await artifactRepo.create({ type: "Plan", version: 1, payloadJson: plan });
    const boom = new Error("executor crashed");
    executorAgent.run.mockRejectedValue(boom);

    await expect(svc.runExecution("run-1")).rejects.toThrow("executor crashed");
    expect(
      eventRepo.create.mock.calls.some(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
      ),
    ).toBe(false);
  });

  it("rejects with a PolicyViolationError when the executor touches a protected path", async () => {
    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const { deps, artifactRepo, executorAgent, eventRepo } = buildDeps(run);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    await artifactRepo.create({ type: "Plan", version: 1, payloadJson: plan });
    const report = makeExecutionReport({ filesChanged: ["protected/secrets.ts"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 9 });

    const err: PolicyViolationError = await svc.runExecution("run-1").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect(err.rule).toBe("executor_touched_protected_path");
    expect(
      eventRepo.create.mock.calls.some(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
      ),
    ).toBe(false);
  });

  describe("stranded-execution recovery", () => {
    it("skips re-running the executor and proceeds straight to review when an orphaned ExecutionReport is detected", async () => {
      const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", prNumber: 5 });
      const { deps, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps(run);
      const svc = new OrchestratorService(deps as never);

      const plan = makePlan({ planVersion: 1 });
      await artifactRepo.create({ type: "Plan", version: 1, payloadJson: plan });

      const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
      await artifactRepo.create({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: reportCreatedAt,
      });
      // The report was created *after* EXECUTION_STARTED and no EXECUTION_FINISHED
      // was ever recorded -- this is the "stranded" signature.
      (eventRepo.findByRunId as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date("2026-01-01T00:00:00Z"),
        } as unknown as RunEventRecord,
      ]);

      reviewerAgent.run.mockImplementation(async () => {
        const review = { reviewId: "rev-1", summary: "ok", findings: [], overallVerdict: "approved" };
        await artifactRepo.create({ type: "Review", version: 1, payloadJson: review });
        return review;
      });

      await svc.runExecution("run-1");

      expect(executorAgent.run).not.toHaveBeenCalled();
      const recoveredEvent = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
      )?.[0] as { payloadJson: { recovered: boolean } };
      expect(recoveredEvent.payloadJson.recovered).toBe(true);
    });

    it("re-runs the executor normally when EXECUTION_FINISHED was already recorded after the report", async () => {
      const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", prNumber: 5 });
      const { deps, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps(run);
      const svc = new OrchestratorService(deps as never);

      const plan = makePlan({ planVersion: 1 });
      await artifactRepo.create({ type: "Plan", version: 1, payloadJson: plan });

      const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
      await artifactRepo.create({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: reportCreatedAt,
      });

      // EXECUTION_FINISHED recorded AFTER the stale report -> not stranded.
      (eventRepo.findByRunId as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date("2026-01-01T00:00:00Z"),
        } as unknown as RunEventRecord,
        {
          id: "e2",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_FINISHED,
          source: "executor-agent",
          payloadJson: {},
          createdAt: new Date("2026-01-01T00:10:00Z"),
        } as unknown as RunEventRecord,
      ]);

      const newReport = makeExecutionReport({ executionVersion: 2 });
      executorAgent.run.mockImplementation(async () => {
        await artifactRepo.create({ type: "ExecutionReport", version: 2, payloadJson: newReport });
        return { report: newReport, prNumber: 5 };
      });
      reviewerAgent.run.mockImplementation(async () => {
        const review = { reviewId: "rev-1", summary: "ok", findings: [], overallVerdict: "approved" };
        await artifactRepo.create({ type: "Review", version: 1, payloadJson: review });
        return review;
      });

      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalledTimes(1);
    });
  });
});
