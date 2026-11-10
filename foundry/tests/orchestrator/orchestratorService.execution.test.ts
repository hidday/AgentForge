import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
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
    scoreRationale: "Looks good.",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "EXECUTION_STARTED",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function buildDeps(
  initialRun: Run,
  opts: { plan?: Plan | null; executionReport?: unknown; events?: RunEventRecord[] } = {},
) {
  let currentRun = initialRun;
  const artifacts = new Map<string, unknown>();
  if (opts.plan !== null) artifacts.set("Plan", { payloadJson: opts.plan ?? makePlan() });
  if (opts.executionReport !== undefined) {
    artifacts.set("ExecutionReport", opts.executionReport);
  }

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      currentRun = { ...currentRun, state: newState };
      return Promise.resolve(currentRun);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return Promise.resolve(currentRun);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi
      .fn()
      .mockImplementation((_id: string, type: string) =>
        Promise.resolve(artifacts.get(type) ?? null),
      ),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue(opts.events ?? []),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Title",
      description: "desc",
      branchName: "ai/lin-1",
      state: "Todo",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
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
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = {
    run: vi.fn().mockResolvedValue({ report: makeExecutionReport(), prNumber: 99 }),
  };
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    executorAgent,
    gitService,
    getCurrentRun: () => currentRun,
  };
}

describe("OrchestratorService.runExecution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects via PolicyViolationError when the run is not in Implementing state", async () => {
    const built = buildDeps(makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    expect(built.executorAgent.run).not.toHaveBeenCalled();
  });

  it("happy path: commits a checkpoint, runs the executor, records the PR number, and delegates to runReview", async () => {
    const built = buildDeps(makeRun());
    const svc = new OrchestratorService(built.deps as never);
    const runReviewSpy = vi
      .spyOn(svc, "runReview")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }) as Run);

    await svc.runExecution("run-1");

    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(built.getCurrentRun().prNumber).toBe(99);
    expect(built.getCurrentRun().state).toBe(RunState.AIReview);
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.slice(
      -1,
    )[0]![1] as string;
    expect(comment).toContain("Execution Report");
  });

  it("recovers a stranded execution (ExecutionReport exists but EXECUTION_FINISHED never recorded) without re-running the executor", async () => {
    const reportCreatedAt = new Date("2024-01-01T00:10:00Z");
    const lastStartedAt = new Date("2024-01-01T00:00:00Z");
    const built = buildDeps(makeRun({ prNumber: 99 }), {
      executionReport: { createdAt: reportCreatedAt, payloadJson: makeExecutionReport() },
      events: [makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: lastStartedAt })],
    });
    const svc = new OrchestratorService(built.deps as never);
    const runReviewSpy = vi
      .spyOn(svc, "runReview")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }) as Run);

    await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    const eventTypes = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    const finishedCall = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    )!;
    expect((finishedCall[0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered).toBe(
      true,
    );
  });

  it("does NOT treat the execution as stranded when EXECUTION_FINISHED was already recorded after the report", async () => {
    const reportCreatedAt = new Date("2024-01-01T00:10:00Z");
    const lastStartedAt = new Date("2024-01-01T00:00:00Z");
    const lastFinishedAt = new Date("2024-01-01T00:20:00Z");
    const built = buildDeps(makeRun({ prNumber: 99 }), {
      executionReport: { createdAt: reportCreatedAt, payloadJson: makeExecutionReport() },
      events: [
        makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: lastStartedAt }),
        makeEvent({ eventType: RunEvent.EXECUTION_FINISHED, createdAt: lastFinishedAt }),
      ],
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }) as Run);

    await svc.runExecution("run-1");

    expect(built.executorAgent.run).toHaveBeenCalledOnce();
  });

  it("on AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a timeout comment, and does not call runReview", async () => {
    const built = buildDeps(makeRun());
    built.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 3_600_000));
    const svc = new OrchestratorService(built.deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(runReviewSpy).not.toHaveBeenCalled();
    const eventTypes = (built.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.slice(
      -1,
    )[0]![1] as string;
    expect(comment).toContain("timed out after 60 minutes");
  });

  it("rethrows non-timeout errors from the executor agent", async () => {
    const built = buildDeps(makeRun());
    built.executorAgent.run.mockRejectedValue(new Error("boom"));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("rejects via PolicyViolationError when the executor touches a protected path", async () => {
    const built = buildDeps(makeRun());
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["protected/secrets.ts"] }),
      prNumber: 99,
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("passes opts.note through to the executor agent as operatorNote", async () => {
    const built = buildDeps(makeRun());
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun() as Run);

    await svc.runExecution("run-1", { note: "focus on perf" });

    expect(built.executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "focus on perf" },
    );
  });
});
