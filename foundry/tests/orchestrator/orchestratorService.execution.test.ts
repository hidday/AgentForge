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
  createdAt?: Date;
}): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}-${Math.random()}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: overrides.createdAt ?? new Date(),
  };
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: RunEventRecord[];
  prNumber: number | null;
}

function buildDeps(store: TestStore, initialRun: Run) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ...initialRun, state: store.runState, prNumber: store.prNumber }),
      ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState, prNumber: store.prNumber });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      if (patch.prNumber !== undefined) store.prNumber = patch.prNumber;
      return Promise.resolve({
        ...initialRun,
        state: store.runState,
        prNumber: store.prNumber,
        ...patch,
      });
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
    create: vi.fn().mockImplementation((params: { eventType: string; source: string; payloadJson?: unknown; runId: string }) => {
      const rec: RunEventRecord = {
        id: `event-${store.events.length}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
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
  // The real ExecutorAgent persists the ExecutionReport artifact itself before
  // returning; mimic that here so downstream runReview() sees it via
  // findLatestByType, matching production behaviour.
  const executorAgent = {
    run: vi.fn().mockImplementation(async (_plan: unknown, _bundle: unknown, runId: string) => {
      const report = makeExecutionReport();
      await artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 1 };
    }),
  };
  const reviewerAgent = {
    run: vi
      .fn()
      .mockImplementation(async (_plan: Plan, _execReport: ExecutionReport, _diff: string, _bundle: unknown, runId: string) => {
        const review = makeReview();
        await artifactRepo.create({
          runId,
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
  it("happy path: checkpoints WIP commit, invokes executor, persists prNumber, transitions to AIReview, then proceeds through review to ReadyForHumanReview", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
      prNumber: null,
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    const report = makeExecutionReport({
      filesChanged: ["src/a.ts", "src/b.ts"],
      notes: ["Watch out for X"],
    });
    built.executorAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 42 };
    });

    const result = await svc.runExecution("run-1");

    // WIP checkpoint commit happened before the executor ran (branchName present)
    expect(built.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(built.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );

    expect(built.executorAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.anything(),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      undefined,
    );

    expect(built.runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 42, executorRuntime: "claude-code" }),
    );

    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    // Execution report comment posted with score + files + notes sections
    const execComment = built.linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((body: string) => body.includes("Execution Report"));
    expect(execComment).toBeDefined();
    expect(execComment).toContain("Score: 90%");
    expect(execComment).toContain("src/a.ts");
    expect(execComment).toContain("Watch out for X");

    // Chained all the way through review (approved) -> markReady -> ReadyForHumanReview
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(built.reviewerAgent.run).toHaveBeenCalledTimes(1);
  });

  it("skips the WIP checkpoint commit when the run has no branchName", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
      prNumber: null,
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: null });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    const report = makeExecutionReport({ filesChanged: [], notes: [] });
    built.executorAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 7 };
    });

    await svc.runExecution("run-1");

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();

    // Zero-files / zero-notes comment should omit the "Files changed" and "Notes" sections
    const execComment = built.linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((body: string) => body.includes("Execution Report"));
    expect(execComment).toBeDefined();
    expect(execComment).not.toContain("Files changed");
    expect(execComment).not.toContain("### Notes");
  });

  it("collapses the file list inside <details> when more than 8 files changed", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
      prNumber: null,
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles });
    built.executorAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 7 };
    });

    await svc.runExecution("run-1");

    const execComment = built.linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((body: string) => body.includes("Execution Report"));
    expect(execComment).toContain("<details>");
    expect(execComment).toContain("Files changed (9)");
  });

  it("recovers a stranded execution: skips the executor and proceeds straight to review when an ExecutionReport already exists without a matching EXECUTION_FINISHED", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:05:00Z"); // after EXECUTION_STARTED
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport(),
          createdAt: t1,
        }),
      ],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: t0,
        },
      ],
      prNumber: 99,
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", prNumber: 99 });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    const recoveredEvent = store.events.find((e) => e.eventType === RunEvent.EXECUTION_FINISHED);
    expect((recoveredEvent?.payloadJson as { recovered: boolean }).recovered).toBe(true);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", prNumber: 99 }),
      expect.stringContaining("Recovered stranded execution"),
    );

    // Proceeded through review (approved, default mock) to ReadyForHumanReview
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(built.reviewerAgent.run).toHaveBeenCalledTimes(1);
  });

  it("transitions to AIBlocked and posts a comment when the executor agent times out", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
      prNumber: null,
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    built.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 3_600_000));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();

    const timeoutEvent = store.events.find((e) => e.eventType === "EXECUTION_TIMEOUT");
    expect(timeoutEvent).toBeDefined();
    expect((timeoutEvent?.payloadJson as { agent: string }).agent).toBe("executor");

    const blockedEvent = store.events.find((e) => e.eventType === RunEvent.BLOCKED);
    expect(blockedEvent).toBeDefined();
    expect((blockedEvent?.payloadJson as { reason: string }).reason).toContain("timed out after 60m");

    const timeoutComment = built.linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((body: string) => body.includes("timed out"));
    expect(timeoutComment).toBeDefined();
  });

  it("rethrows non-timeout errors raised by the executor agent", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
      prNumber: null,
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    built.executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("forwards an operator note to the executor agent as an operatorNote option", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
      prNumber: null,
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    built.executorAgent.run.mockImplementation(async () => {
      const report = makeExecutionReport();
      await built.artifactRepo.create({ runId: "run-1", type: "ExecutionReport", version: 1, payloadJson: report, rawText: "{}" });
      return { report, prNumber: 7 };
    });

    await svc.runExecution("run-1", { note: "Use the new auth library" });

    expect(built.executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "Use the new auth library" },
    );
  });

  it("throws a PolicyViolationError and never invokes the executor when the run is not Implementing", async () => {
    const store: TestStore = {
      runState: RunState.Todo,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
      prNumber: null,
    };
    const initialRun = makeRun({ state: RunState.Todo });
    const built = buildDeps(store, initialRun);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    expect(built.executorAgent.run).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.approvePlan", () => {
  function buildApproveDeps(run: Run, plan: Plan) {
    const runRepo = {
      findById: vi.fn().mockResolvedValue(run),
      findActiveByIssueId: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      findByIssueId: vi.fn(),
      updateState: vi.fn().mockResolvedValue({ ...run, state: RunState.Implementing }),
      update: vi.fn().mockResolvedValue({ ...run, approvedPlanVersion: plan.planVersion }),
    };
    const artifactRepo = {
      create: vi.fn(),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) =>
        type === "Plan"
          ? Promise.resolve(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }))
          : Promise.resolve(null),
      ),
    };
    const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
    const linearClient = { getIssue: vi.fn(), postComment: vi.fn().mockResolvedValue(undefined) };
    const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
    const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const gitService = { resolveMainRepoPath: vi.fn().mockReturnValue(run.workingDirectory) };
    const deps = {
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient,
      githubClient: { getPRDiff: vi.fn() },
      gitService,
      repoRegistry: { resolveForIssue: vi.fn(), resolveWorkingDirectory: vi.fn(), validateWorkingDirectory: vi.fn(), getRepoByName: vi.fn(), getDefaultRepo: vi.fn() },
      linearSync,
      githubSync,
      plannerAgent: { run: vi.fn() },
      planReviewerAgent: { run: vi.fn() },
      planReviserAgent: { run: vi.fn() },
      executorAgent: { run: vi.fn() },
      reviewerAgent: { run: vi.fn() },
      remediationAgent: { run: vi.fn() },
      logger,
    };
    return { deps, runRepo, artifactRepo, linearClient };
  }

  it("approves without a note: updates approvedPlanVersion, transitions to Implementing, posts a simple comment", async () => {
    const plan = makePlan({ planVersion: 3 });
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });
    const { deps, runRepo, linearClient } = buildApproveDeps(run, plan);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v3 approved. Starting implementation...",
    );
    expect(result.state).toBe(RunState.Implementing);
  });

  it("approves with an operator note: comment includes the note", async () => {
    const plan = makePlan({ planVersion: 2 });
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, linearClient } = buildApproveDeps(run, plan);
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1", { note: "Please use the new auth lib" });

    const call = linearClient.postComment.mock.calls[0];
    expect(call[1]).toContain("approved with operator note");
    expect(call[1]).toContain("Please use the new auth lib");
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo } = buildApproveDeps(run, makePlan());
    (artifactRepo.findLatestByType as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});
