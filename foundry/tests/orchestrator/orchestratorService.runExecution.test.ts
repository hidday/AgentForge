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
    scoreRationale: "Looks solid.",
    ...overrides,
  };
}

function asArtifact(o: { type: string; version: number; payloadJson: unknown; createdAt?: Date }): Artifact {
  return {
    id: `artifact-${o.type}-${o.version}-${Math.random().toString(36).slice(2, 7)}`,
    runId: "run-1",
    type: o.type as Artifact["type"],
    version: o.version,
    payloadJson: o.payloadJson,
    rawText: JSON.stringify(o.payloadJson),
    createdAt: o.createdAt ?? new Date(),
  };
}

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
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
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `evt-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(Date.now() + store.events.length),
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
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff"), getDefaultBranch: vi.fn().mockResolvedValue("main") };

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
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = {
    run: vi.fn().mockImplementation(() => {
      // Simulate the real ReviewerAgent persisting its Review artifact.
      const review = {
        reviewId: "rev-1",
        summary: "Looks good",
        findings: [],
        overallVerdict: "approved",
      };
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return Promise.resolve(review);
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    executorAgent,
    reviewerAgent,
    gitService,
    logger,
    repoRegistry,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws when the run does not exist", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store);
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("missing")).rejects.toThrow(/Run not found/);
  });

  it("rejects via policy when the run is not in Implementing state", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun({ state: RunState.PlanReview }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("happy path: commits a WIP checkpoint, runs the executor, transitions to AIReview, and continues into runReview", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, executorAgent, gitService, eventRepo, linearClient, reviewerAgent } = buildDeps(store);
    const report = makeExecutionReport();
    executorAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }));
      return Promise.resolve({ report, prNumber: 7 });
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    expect(store.run.prNumber).toBe(7);
    expect(store.run.executorRuntime).toBe("claude-code");
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    // runReview should have continued and (with an approved review) marked ready.
    expect(reviewerAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("formats the execution comment with no 'Files changed' or 'Notes' sections when both are empty", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, executorAgent, linearClient } = buildDeps(store);
    const report = makeExecutionReport({ filesChanged: [], notes: [] });
    executorAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }));
      return Promise.resolve({ report, prNumber: 7 });
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls.find((c) =>
      (c[1] as string).includes("Execution Report"),
    )![1] as string;
    expect(comment).not.toContain("Files changed");
    expect(comment).not.toContain("### Notes");
  });

  it("collapses the file list into a <details> block and includes a Notes section when there are many files and notes", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, executorAgent, linearClient } = buildDeps(store);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({
      filesChanged: manyFiles,
      notes: ["Worth a second look."],
      checks: {
        lint: { status: "fail", details: "2 problems" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "skip", details: "not run" },
      },
    });
    executorAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }));
      return Promise.resolve({ report, prNumber: 7 });
    });
    const svc = new OrchestratorService(deps as never);

    // The intentionally-failing lint check means runReview's follow-on
    // markReady() rejects (out of scope here); we only assert on the
    // execution-report comment that is posted before that point.
    await expect(svc.runExecution("run-1")).rejects.toThrow(/failing checks/);

    const comment = linearClient.postComment.mock.calls.find((c) =>
      (c[1] as string).includes("Execution Report"),
    )![1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Worth a second look.");
    expect(comment).toContain(":x:"); // fail icon
    expect(comment).toContain(":heavy_minus_sign:"); // skip icon
  });

  it("does not attempt a git checkpoint when the run has no branchName", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun({ branchName: null }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, executorAgent, gitService } = buildDeps(store);
    const report = makeExecutionReport();
    executorAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }));
      return Promise.resolve({ report, prNumber: 7 });
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("passes the operator note through to the executor agent", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, executorAgent } = buildDeps(store);
    const report = makeExecutionReport();
    executorAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }));
      return Promise.resolve({ report, prNumber: 7 });
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runExecution("run-1", { note: "focus on perf" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      { operatorNote: "focus on perf" },
    );
  });

  it("recovers a stranded execution: skips the executor and goes straight to review when an ExecutionReport exists after the last EXECUTION_STARTED with no later EXECUTION_FINISHED", async () => {
    const plan = makePlan({ planVersion: 1 });
    const earlier = new Date("2024-01-01T00:00:00Z");
    const later = new Date("2024-01-01T00:05:00Z");
    const report = makeExecutionReport();
    const store: Store = {
      run: makeRun({ prNumber: 99 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report, createdAt: later }),
      ],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: earlier,
        },
      ],
    };
    const { deps, executorAgent, eventRepo, reviewerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    const recoveredEvent = eventRepo.create.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(recoveredEvent).toBeDefined();
    expect((recoveredEvent![0] as { payloadJson: { recovered?: boolean } }).payloadJson.recovered).toBe(
      true,
    );
    // Continues into runReview.
    expect(reviewerAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does NOT take the recovery shortcut when EXECUTION_FINISHED already fired after the report", async () => {
    const plan = makePlan({ planVersion: 1 });
    const earlyStart = new Date("2024-01-01T00:00:00Z");
    const reportTime = new Date("2024-01-01T00:05:00Z");
    const finishTime = new Date("2024-01-01T00:06:00Z");
    const oldReport = makeExecutionReport();
    const store: Store = {
      run: makeRun({ prNumber: 99 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: oldReport, createdAt: reportTime }),
      ],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_STARTED,
          source: "orchestrator",
          payloadJson: {},
          createdAt: earlyStart,
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: RunEvent.EXECUTION_FINISHED,
          source: "executor-agent",
          payloadJson: {},
          createdAt: finishTime,
        },
      ],
    };
    const { deps, executorAgent } = buildDeps(store);
    const newReport = makeExecutionReport({ executionVersion: 2 });
    executorAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 2, payloadJson: newReport }));
      return Promise.resolve({ report: newReport, prNumber: 99 });
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runExecution("run-1");

    // Since EXECUTION_FINISHED is newer than the report, the recovery branch must
    // not trigger and the executor should run normally.
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("does not take the recovery shortcut when the run has no prNumber yet", async () => {
    const plan = makePlan({ planVersion: 1 });
    const oldReport = makeExecutionReport();
    const store: Store = {
      run: makeRun({ prNumber: null }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: oldReport }),
      ],
      events: [],
    };
    const { deps, executorAgent } = buildDeps(store);
    const newReport = makeExecutionReport({ executionVersion: 2 });
    executorAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 2, payloadJson: newReport }));
      return Promise.resolve({ report: newReport, prNumber: 101 });
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("on AgentTimeoutError: records an EXECUTION_TIMEOUT event, transitions to AIBlocked, posts a comment, and returns without raising", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, executorAgent, eventRepo, linearClient } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    const timeoutEvent = eventRepo.create.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();
    expect((timeoutEvent![0] as { payloadJson: { agent: string; timeoutMs: number } }).payloadJson).toEqual(
      { agent: "executor", timeoutMs: 1_800_000 },
    );
    const blockedEvent = eventRepo.create.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(blockedEvent).toBeDefined();
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out after 30 minutes"),
    );
  });

  it("re-throws non-timeout errors from the executor agent", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, executorAgent } = buildDeps(store);
    executorAgent.run.mockRejectedValue(new Error("boom"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("throws a policy violation when the executor touches a protected path", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, executorAgent, repoRegistry } = buildDeps(store);
    (repoRegistry.getRepoByName as ReturnType<typeof vi.fn>).mockReturnValue({
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
    });
    const report = makeExecutionReport({ filesChanged: ["protected/secrets.ts"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });
});
