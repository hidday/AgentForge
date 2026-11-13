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
    scoreRationale: "Clean implementation.",
    ...overrides,
  };
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function asArtifact(params: {
  type: string;
  version: number;
  payloadJson: unknown;
  createdAt?: Date;
}): Artifact {
  return {
    id: `artifact-${params.type}-${params.version}`,
    runId: "run-1",
    type: params.type as Artifact["type"],
    version: params.version,
    payloadJson: params.payloadJson,
    rawText: JSON.stringify(params.payloadJson),
    createdAt: params.createdAt ?? new Date(),
  };
}

function buildDeps(store: TestStore, initialRun: Run) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ ...initialRun, id, state: store.runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, params: Record<string, unknown>) => {
      Object.assign(initialRun, params);
      return Promise.resolve({ ...initialRun, ...params, state: store.runState });
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
    create: vi.fn().mockImplementation((params: { eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `event-${store.events.length}`,
        runId: "run-1",
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
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
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoEntry = {
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
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
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
  const executorAgent = {
    run: vi.fn().mockResolvedValue({ report: makeExecutionReport(), prNumber: 101 }),
  };
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
    linearClient,
    gitService,
    executorAgent,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws when the run is not in Implementing state", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("happy path: runs the executor, posts the execution report, and proceeds to code review", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const built = buildDeps(store, initialRun);
    // Spy out runReview since it's covered in its own test file; we only care
    // that runExecution reaches and invokes it correctly here.
    const svc = new OrchestratorService(built.deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const result = await svc.runExecution("run-1", { note: "focus on the happy path" });

    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(built.executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      { operatorNote: "focus on the happy path" },
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AIReview);

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(comment).toBeDefined();
  });

  it("skips git operations when the run has no branchName", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: null });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("recovers a stranded execution: skips the executor and jumps straight to review", async () => {
    const started = new Date("2024-01-01T00:00:00Z");
    const reportCreated = new Date("2024-01-01T00:05:00Z");
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport(),
          createdAt: reportCreated,
        }),
      ],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: started,
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: 55 });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AIReview);

    const recoveredEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(recoveredEvent).toBeDefined();
    expect((recoveredEvent![0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered).toBe(
      true,
    );

    const warnCall = built.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Recovered stranded execution"),
    );
    expect(warnCall).toBeDefined();
  });

  it("does NOT recover when EXECUTION_FINISHED already fired after the report", async () => {
    const started = new Date("2024-01-01T00:00:00Z");
    const reportCreated = new Date("2024-01-01T00:05:00Z");
    const finished = new Date("2024-01-01T00:06:00Z");
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport(),
          createdAt: reportCreated,
        }),
      ],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: started,
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_FINISHED,
          source: "executor-agent",
          payloadJson: {},
          createdAt: finished,
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: 55, branchName: null });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    // Already-finished + has a report -> falls through to normal execution (re-run executor)
    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("handles AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to AIBlocked, and returns without reviewing", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const built = buildDeps(store, initialRun);
    built.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));
    const svc = new OrchestratorService(built.deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(runReviewSpy).not.toHaveBeenCalled();

    const timeoutEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();

    const blockedComment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("timed out"),
    );
    expect(blockedComment).toBeDefined();

    const errorLog = built.logger.error.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("timed out"),
    );
    expect(errorLog).toBeDefined();
  });

  it("re-throws non-timeout errors from the executor", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const built = buildDeps(store, initialRun);
    built.executorAgent.run.mockRejectedValue(new Error("unexpected crash"));
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("unexpected crash");
  });

  it("propagates a PolicyViolationError when the executor touches a protected path", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing });
    const built = buildDeps(store, initialRun);
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["secrets/key.pem"] }),
      prNumber: 7,
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    // EXECUTION_STARTED was recorded before the policy check ran
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).not.toContain(RunEvent.EXECUTION_FINISHED);
  });
});
