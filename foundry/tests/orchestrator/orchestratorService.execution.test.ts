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
    summary: "Implemented the thing.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks solid.",
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown; id?: string }): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, initialRun: Run, agentOverrides: Record<string, unknown> = {}) {
  // `run` is the single mutable source of truth: both updateState and update
  // write into it so a later findById (e.g. inside a chained runReview call)
  // observes fields set earlier in the same flow (prNumber, executorRuntime, ...).
  const run: Run = { ...initialRun };
  run.state = store.runState;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...run, state: store.runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      run.state = newState;
      return Promise.resolve({ ...run, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      Object.assign(run, patch);
      return Promise.resolve({ ...run, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson,
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
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
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn().mockReturnValue({
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
  // The real ReviewerAgent persists its own "Review" artifact as a side
  // effect of run(); replicate that here so markReady (which reads the
  // latest Review artifact) sees a consistent post-condition.
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = {
        reviewId: "rev-1",
        summary: "Looks good",
        findings: [],
        overallVerdict: "approved" as const,
      };
      await artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review),
      });
      return review;
    }),
  };
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
      ...agentOverrides,
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

describe("OrchestratorService.startRun -- active run already exists", () => {
  it("returns the existing active run without creating a new one", async () => {
    const store: TestStore = { runState: RunState.Planning, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.Planning });
    const { deps, runRepo } = buildDeps(store, initialRun);
    const existing = { ...initialRun };
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runExecution", () => {
  it("happy path: runs executor, records EXECUTION_FINISHED, and proceeds through review to markReady", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const { deps, executorAgent, gitService, linearClient } = buildDeps(store, initialRun);

    const report = makeExecutionReport();
    executorAgent.run.mockImplementation(async () => {
      await deps.artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: 1,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 7 };
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    // Checkpoint commit before executor since branchName is set
    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );

    expect(executorAgent.run).toHaveBeenCalledTimes(1);

    const commentBodies = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(commentBodies.some((b) => b.includes("Execution Report"))).toBe(true);

    // Final state should have advanced all the way to ReadyForHumanReview
    // (review approved -> markReady), proving runReview was chained.
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(commentBodies.some((b) => b.includes("Ready for Human Review"))).toBe(true);
  });

  it("skips the checkpoint commit when the run has no branchName", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: null });
    const { deps, executorAgent, gitService } = buildDeps(store, initialRun);
    const report2 = makeExecutionReport();
    executorAgent.run.mockImplementation(async () => {
      await deps.artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: 1,
        payloadJson: report2,
        rawText: JSON.stringify(report2),
      });
      return { report: report2, prNumber: 7 };
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("crash recovery: skips re-running the executor when an ExecutionReport exists with no matching EXECUTION_FINISHED", async () => {
    const reportCreatedAt = new Date("2026-01-01T00:00:10Z");
    const startedAt = new Date("2026-01-01T00:00:00Z");

    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        { ...asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }), createdAt: reportCreatedAt },
      ],
      events: [
        {
          id: "e-start",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: startedAt,
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: 7 });
    const { deps, executorAgent, linearClient } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();

    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    const recoveredEvent = store.events.find((e) => e.eventType === RunEvent.EXECUTION_FINISHED);
    expect((recoveredEvent?.payloadJson as { recovered?: boolean })?.recovered).toBe(true);

    // Proceeded into runReview afterwards
    expect(linearClient.getIssue).toHaveBeenCalled();
    expect(result.state).toBeDefined();
  });

  it("does NOT take the crash-recovery path when an EXECUTION_FINISHED already followed the report", async () => {
    const reportCreatedAt = new Date("2026-01-01T00:00:10Z");
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const finishedAt = new Date("2026-01-01T00:00:20Z");

    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        { ...asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }), createdAt: reportCreatedAt },
      ],
      events: [
        { id: "e-start", runId: "run-1", eventType: RunEvent.EXECUTION_STARTED, source: "orchestrator", payloadJson: {}, createdAt: startedAt },
        { id: "e-finish", runId: "run-1", eventType: RunEvent.EXECUTION_FINISHED, source: "executor-agent", payloadJson: {}, createdAt: finishedAt },
      ],
    };
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: 7 });
    const { deps, executorAgent } = buildDeps(store, initialRun);
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport({ executionVersion: 2 }), prNumber: 7 });

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    // Since EXECUTION_FINISHED already came after the existing report, the
    // orchestrator must NOT treat this as a stranded crash and must re-run
    // the executor normally.
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("on AgentTimeoutError: logs, records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and returns without running review", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const { deps, executorAgent, linearClient } = buildDeps(store, initialRun);

    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);

    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
    expect(eventTypes).toContain(RunEvent.BLOCKED);

    const commentBodies = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(commentBodies.some((b) => b.includes("timed out"))).toBe(true);
  });

  it("rethrows non-AgentTimeoutError executor failures without transitioning the run", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const { deps, executorAgent } = buildDeps(store, initialRun);

    executorAgent.run.mockRejectedValue(new Error("executor crashed unexpectedly"));

    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("executor crashed unexpectedly");
    expect(store.runState).toBe(RunState.Implementing);
  });

  it("throws a PolicyViolationError (via assertCanExecute) when the run is not Implementing", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Todo });
    const { deps, executorAgent } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    expect(executorAgent.run).not.toHaveBeenCalled();
  });

  it("throws a PolicyViolationError when the executor's filesChanged touches a protected path", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const { deps, executorAgent } = buildDeps(store, initialRun);
    (deps.repoRegistry.getDefaultRepo as ReturnType<typeof vi.fn>).mockReturnValue({
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

    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["secrets/key.txt"] }),
      prNumber: 7,
    });

    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    // State should not have advanced past EXECUTION_FINISHED since the assertion
    // runs before that transition.
    expect(store.runState).toBe(RunState.Implementing);
  });
});
