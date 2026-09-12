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
    scoreRationale: "All green.",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version ?? 1}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
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
    create: vi
      .fn()
      .mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
        const a = makeArtifact({
          type: params.type as Artifact["type"],
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
      return Promise.resolve(
        matching.reduce((best, cur) => (cur.version > best.version ? cur : best)),
      );
    }),
  };

  let eventSeq = 0;
  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      eventSeq += 1;
      const rec: RunEventRecord = {
        id: `event-${eventSeq}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson,
        createdAt: new Date(2024, 0, 1, 0, 0, eventSeq),
      };
      store.events.push(rec);
      return Promise.resolve(rec);
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

describe("OrchestratorService.runExecution -- policy guard", () => {
  it("throws PolicyViolationError when the run is not Implementing", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.Todo }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, executorAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "execute_requires_implementing_state",
    });
    expect(executorAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runExecution -- crash-recovery idempotency", () => {
  it("skips the executor and records a recovered EXECUTION_FINISHED when a stranded ExecutionReport is found", async () => {
    const store: TestStore = {
      run: makeRun({ prNumber: 7 }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [
        {
          id: "e-started",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date(2024, 0, 1, 0, 0, 0),
        },
      ],
    };
    // The ExecutionReport artifact was created AFTER EXECUTION_STARTED, and no
    // EXECUTION_FINISHED was ever recorded -- the stranded-execution scenario.
    store.artifacts.push(
      makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: new Date(2024, 0, 1, 0, 0, 30),
      }),
    );

    const { deps, executorAgent, eventRepo } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    // runReview will fail past this point (no Review artifact yet for markReady),
    // which is fine -- we only assert the recovery behaviour itself here.
    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);

    expect(executorAgent.run).not.toHaveBeenCalled();
    const recoveredEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(recoveredEvent).toBeDefined();
    expect((recoveredEvent![0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered).toBe(
      true,
    );
  });

  it("does NOT recover (runs the executor normally) when EXECUTION_FINISHED already followed the report", async () => {
    const store: TestStore = {
      run: makeRun({ prNumber: 7 }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [
        {
          id: "e-started",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date(2024, 0, 1, 0, 0, 0),
        },
        {
          id: "e-finished",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_FINISHED,
          source: "executor-agent",
          payloadJson: {},
          createdAt: new Date(2024, 0, 1, 0, 1, 0),
        },
      ],
    };
    store.artifacts.push(
      makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: new Date(2024, 0, 1, 0, 0, 30),
      }),
    );

    const { deps, executorAgent } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new Error("boom, stop the test here"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom, stop the test here");
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });
});

describe("OrchestratorService.runExecution -- git checkpoint", () => {
  it("commits a WIP checkpoint before invoking the executor when a branchName exists", async () => {
    const store: TestStore = {
      run: makeRun({ branchName: "ai/run-1" }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, executorAgent, gitService } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new Error("stop after checkpoint"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("stop after checkpoint");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );
  });

  it("skips the git checkpoint when the run has no branchName", async () => {
    const store: TestStore = {
      run: makeRun({ branchName: null }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, executorAgent, gitService } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new Error("stop, no branch"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("stop, no branch");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runExecution -- executor failure handling", () => {
  it("catches AgentTimeoutError, records EXECUTION_TIMEOUT + BLOCKED, and returns without reviewing", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, executorAgent, reviewerAgent, eventRepo, linearClient } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 90 * 60_000));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(reviewerAgent.run).not.toHaveBeenCalled();

    const timeoutEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();
    expect(
      (timeoutEvent![0] as { payloadJson: { agent: string; timeoutMs: number } }).payloadJson,
    ).toEqual({ agent: "executor", timeoutMs: 90 * 60_000 });

    const blockedComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("timed out"),
    );
    expect(blockedComment).toBeDefined();
    expect(blockedComment![1]).toContain("90 minutes");
  });

  it("rethrows non-timeout errors without blocking the run", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, eventRepo } = buildDeps(store);
    (deps.executorAgent.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network blip"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("network blip");

    const blockedEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(blockedEvent).toBeUndefined();
  });
});

describe("OrchestratorService.runExecution -- executor path policy", () => {
  it("rejects when the executor touches a protected path", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, eventRepo } = buildDeps(store);
    (deps.executorAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["protected/secrets.ts"] }),
      prNumber: 12,
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "executor_touched_protected_path",
    });

    const finishedEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(finishedEvent).toBeUndefined();
  });
});

describe("OrchestratorService.runExecution -- happy path", () => {
  it("persists prNumber, transitions to AIReview, posts the execution report comment, and proceeds to review", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const { deps, reviewerAgent, linearClient } = buildDeps(store);
    (deps.executorAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      report: makeExecutionReport(),
      prNumber: 12,
    });
    // Let runReview's own policy guard stop things right after the executor
    // succeeds; assertCanReview will pass (state AIReview, prNumber set,
    // ExecutionReport present isn't persisted by our mock executor though) --
    // findLatestByType("ExecutionReport") returns null so it should fail there.
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "review_requires_execution_report",
    });

    expect(store.run.prNumber).toBe(12);
    expect(store.run.state).toBe(RunState.AIReview);
    const reportComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(reportComment).toBeDefined();
    expect(reviewerAgent.run).not.toHaveBeenCalled();
  });
});
