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
    score: 0.95,
    scoreRationale: "All green.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-001",
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
}): Artifact {
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
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

// Production executorAgent/reviewerAgent implementations persist their own
// artifacts before returning. Test overrides that replace the default mock
// implementation must do the same so downstream findLatestByType() calls
// (assertCanReview / assertCanMarkReady) see them.
async function persistExecutionReport(
  artifactRepo: { create: ReturnType<typeof vi.fn> },
  report: ExecutionReport,
): Promise<void> {
  await artifactRepo.create({
    runId: "run-1",
    type: "ExecutionReport",
    version: report.executionVersion,
    payloadJson: report,
    rawText: JSON.stringify(report),
  });
}

async function persistReview(
  artifactRepo: { create: ReturnType<typeof vi.fn> },
  review: Review,
): Promise<void> {
  await artifactRepo.create({
    runId: "run-1",
    type: "Review",
    version: 1,
    payloadJson: review,
    rawText: JSON.stringify(review),
  });
}

function buildDeps(store: TestStore, depOverrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...store.run, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      store.run = { ...store.run, state: newState };
      return Promise.resolve(store.run);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve(store.run);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
        const a = asArtifact({
          type: params.type,
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
      },
    ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
        const e: RunEventRecord = {
          id: `event-${store.events.length}`,
          runId: params.runId,
          eventType: params.eventType,
          source: params.source,
          payloadJson: params.payloadJson ?? {},
          createdAt: new Date(),
        };
        store.events.push(e);
        return Promise.resolve(e);
      },
    ),
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

  const executorAgent = {
    run: vi.fn().mockImplementation(async () => {
      const report = makeExecutionReport();
      await persistExecutionReport(artifactRepo, report);
      return { report, prNumber: 101 };
    }),
  };
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = makeReview();
      await persistReview(artifactRepo, review);
      return review;
    }),
  };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
      ...depOverrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    executorAgent,
    reviewerAgent,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("happy path: runs executor, transitions to AIReview, posts comment, then proceeds through approved review to ReadyForHumanReview", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: null });
    const store: TestStore = {
      runState: RunState.Implementing,
      run: initialRun,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };

    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );

    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);

    // Final state after approved review -> markReady
    expect(result.state).toBe(RunState.ReadyForHumanReview);

    // Execution report comment was posted
    const executionComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    );
    expect(executionComment).toBeDefined();

    // markReady's final comment was posted
    const readyComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Ready for Human Review"),
    );
    expect(readyComment).toBeDefined();
  });

  it("idempotency/crash recovery: skips executor when an unfinished ExecutionReport already exists for the current attempt", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: 99 });
    const existingReport = makeExecutionReport({ executionVersion: 1 });

    const store: TestStore = {
      runState: RunState.Implementing,
      run: initialRun,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: existingReport }),
      ],
      events: [
        {
          id: "e-start",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          // Older than "now" so the pre-existing report counts as "after last start".
          createdAt: new Date(Date.now() - 10_000),
        },
      ],
    };

    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runExecution("run-1");

    // Executor must NOT have been invoked -- recovered path skips it entirely.
    expect(built.executorAgent.run).not.toHaveBeenCalled();

    const eventTypes = store.events.map((e) => e.eventType);
    const recoveredFinish = store.events.find(
      (e) => e.eventType === (RunEvent.EXECUTION_FINISHED as string),
    );
    expect(recoveredFinish).toBeDefined();
    expect((recoveredFinish!.payloadJson as { recovered?: boolean }).recovered).toBe(true);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("AgentTimeoutError: transitions to AIBlocked, posts a timeout comment, and does not call runReview", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: null });
    const store: TestStore = {
      runState: RunState.Implementing,
      run: initialRun,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };

    const built = buildDeps(store);
    built.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();

    const timeoutEvent = store.events.find((e) => e.eventType === "EXECUTION_TIMEOUT");
    expect(timeoutEvent).toBeDefined();
    expect((timeoutEvent!.payloadJson as { agent: string }).agent).toBe("executor");

    const timeoutComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("timed out"),
    );
    expect(timeoutComment).toBeDefined();
  });

  it("rethrows non-timeout errors from the executor agent without transitioning state", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: null });
    const store: TestStore = {
      runState: RunState.Implementing,
      run: initialRun,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };

    const built = buildDeps(store);
    const boom = new Error("executor crashed unexpectedly");
    built.executorAgent.run.mockRejectedValue(boom);

    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("executor crashed unexpectedly");
    expect(store.runState).toBe(RunState.Implementing);
  });

  it("throws PolicyViolationError via assertCanExecute when run is not in Implementing state, without invoking the executor", async () => {
    const initialRun = makeRun({ state: RunState.Todo, approvedPlanVersion: 1 });
    const store: TestStore = {
      runState: RunState.Todo,
      run: initialRun,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };

    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.executorAgent.run).not.toHaveBeenCalled();
  });

  it("skips git commit/push checkpoint when the run has no branchName", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, branchName: null, prNumber: null });
    const store: TestStore = {
      runState: RunState.Implementing,
      run: initialRun,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };

    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
  });

  it("buildTaskBundle: uses the remote default branch and warns when it differs from config", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: null });
    const store: TestStore = {
      runState: RunState.Implementing,
      run: initialRun,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };

    const built = buildDeps(store);
    built.githubClient.getDefaultBranch.mockResolvedValue("trunk");
    built.executorAgent.run.mockImplementation(async (_plan: unknown, bundle: { repo: { defaultBranch: string } }) => {
      expect(bundle.repo.defaultBranch).toBe("trunk");
      const report = makeExecutionReport();
      await persistExecutionReport(built.artifactRepo, report);
      return { report, prNumber: 5 };
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
    const warnCall = built.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Config defaultBranch differs"),
    );
    expect(warnCall).toBeDefined();
  });

  it("buildTaskBundle: falls back to config default branch when GitHub lookup throws", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, prNumber: null });
    const store: TestStore = {
      runState: RunState.Implementing,
      run: initialRun,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };

    const built = buildDeps(store);
    built.githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub unreachable"));
    built.executorAgent.run.mockImplementation(async (_plan: unknown, bundle: { repo: { defaultBranch: string } }) => {
      expect(bundle.repo.defaultBranch).toBe("main");
      const report = makeExecutionReport();
      await persistExecutionReport(built.artifactRepo, report);
      return { report, prNumber: 5 };
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    const warnCall = built.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Failed to resolve default branch"),
    );
    expect(warnCall).toBeDefined();
  });
});

describe("OrchestratorService.startRun active-run guard", () => {
  it("returns the existing active run without calling linearClient.getIssue when one already exists", async () => {
    const activeRun = makeRun({ id: "run-existing", state: RunState.Planning });
    const store: TestStore = {
      runState: RunState.Planning,
      run: activeRun,
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store, {});
    built.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toBe(activeRun);
    expect(built.linearClient.getIssue).not.toHaveBeenCalled();
  });
});
