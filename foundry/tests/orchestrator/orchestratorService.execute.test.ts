import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
  createdAt?: Date;
}): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
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

function buildDeps(store: TestStore) {
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
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }) => {
      const a = asArtifact({
        type: params.type,
        version: params.version,
        payloadJson: params.payloadJson,
      });
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
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };

  // Simulates the real ExecutorAgent, which persists the ExecutionReport
  // artifact itself before returning.
  const executorAgent = {
    run: vi.fn().mockImplementation(async () => {
      const report = makeExecutionReport();
      await artifactRepo.create({
        runId: store.run.id,
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 42 };
    }),
  };

  // Simulates the real ReviewerAgent persisting its Review artifact.
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = makeReview();
      await artifactRepo.create({
        runId: store.run.id,
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
    reviewerAgent,
    gitService,
    linearClient,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws PolicyViolationError and never invokes the executor when the run is not Implementing", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    expect(built.executorAgent.run).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError when the plan version does not match the approved version", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("execute_plan_version_mismatch");
    expect(built.executorAgent.run).not.toHaveBeenCalled();
  });

  it("happy path: commits a WIP checkpoint, runs the executor, persists prNumber, transitions to AIReview, and proceeds into review", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing, branchName: "ai/run-1" }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    // Checkpoint commit before executor run
    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );

    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    // prNumber and executorRuntime persisted
    expect(built.runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 42, executorRuntime: "claude-code" }),
    );

    // Comment posted with the execution report
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );

    // Flowed all the way through review -> approved -> ReadyForHumanReview
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips the checkpoint commit when the run has no branchName yet", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing, branchName: null }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError and does not transition to AIReview when the executor touches a protected path", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    built.executorAgent.run.mockImplementation(async () => {
      const report = makeExecutionReport({ filesChanged: ["secrets/keys.json"] });
      await built.artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: 1,
        payloadJson: report,
        rawText: "{}",
      });
      return { report, prNumber: 42 };
    });
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught?.rule).toBe("executor_touched_protected_path");
    // The run should still be Implementing -- EXECUTION_FINISHED was never recorded.
    expect(store.run.state).toBe(RunState.Implementing);
  });

  it("on AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and does not rethrow", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    built.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
  });

  it("rethrows non-timeout errors from the executor without touching run state", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    const boom = new Error("executor crashed");
    built.executorAgent.run.mockRejectedValue(boom);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("executor crashed");
    expect(store.run.state).toBe(RunState.Implementing);
  });

  it("crash recovery: skips re-running the executor and jumps to review when a stranded ExecutionReport is found", async () => {
    const now = Date.now();
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing, prNumber: 42 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport(),
          createdAt: new Date(now),
        }),
      ],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date(now - 10_000),
        },
      ],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    // Executor must NOT be invoked again.
    expect(built.executorAgent.run).not.toHaveBeenCalled();

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    const finishedEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    )?.[0] as { payloadJson: { recovered: boolean } };
    expect(finishedEvent.payloadJson.recovered).toBe(true);

    // Should have gone through review -> approved.
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does NOT trigger crash recovery when EXECUTION_FINISHED already fired after the report was created", async () => {
    const now = Date.now();
    const store: TestStore = {
      run: makeRun({ state: RunState.Implementing, prNumber: 42, branchName: null }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport(),
          createdAt: new Date(now - 20_000),
        }),
      ],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date(now - 30_000),
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_FINISHED,
          source: "executor-agent",
          payloadJson: {},
          createdAt: new Date(now - 10_000),
        },
      ],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    // A normal (non-recovered) run should invoke the executor as usual.
    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
  });
});
