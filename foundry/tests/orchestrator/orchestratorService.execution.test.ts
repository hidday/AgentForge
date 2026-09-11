import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, ArtifactType, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
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
    filesChanged: ["src/a.ts"],
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

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

const REPO_ENTRY = {
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
};

// ---------------------------------------------------------------------------
// Stateful harness (see orchestratorService.lifecycle.test.ts for the same
// pattern -- duplicated here per-file by convention).
// ---------------------------------------------------------------------------

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function makeArtifact(store: Store, type: ArtifactType, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: store.run.id,
    type,
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

/**
 * Queues a single executorAgent.run() resolution AND -- mirroring what the
 * real ExecutorAgent does in production -- persists the resulting
 * ExecutionReport as an artifact, so that the cascaded runReview() can find
 * it via findLatestByType("ExecutionReport").
 */
function queueExecutorResult(
  h: { executorAgent: { run: ReturnType<typeof vi.fn> }; store: Store },
  report: ExecutionReport,
  prNumber: number,
) {
  h.executorAgent.run.mockImplementationOnce(async () => {
    h.store.artifacts.push(
      makeArtifact(h.store, "ExecutionReport", report.executionVersion, report),
    );
    return { report, prNumber };
  });
}

/**
 * Queues a single reviewerAgent.run() resolution AND persists the resulting
 * Review artifact, mirroring the real ReviewerAgent, so markReady()'s policy
 * checks (which read the latest Review artifact) can find it.
 */
function queueReviewerResult(
  h: { reviewerAgent: { run: ReturnType<typeof vi.fn> }; store: Store },
  review: Review,
) {
  h.reviewerAgent.run.mockImplementationOnce(async () => {
    h.store.artifacts.push(makeArtifact(h.store, "Review", 1, review));
    return review;
  });
}

function buildHarness(initialRun: Run, initialArtifacts: Artifact[] = []) {
  const store: Store = { run: initialRun, artifacts: [...initialArtifacts], events: [] };

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
      .mockImplementation(
        (params: { runId: string; type: string; version: number; payloadJson: unknown }) => {
          const a = makeArtifact(store, params.type as ArtifactType, params.version, params.payloadJson);
          store.artifacts.push(a);
          return Promise.resolve(a);
        },
      ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length}`,
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
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(REPO_ENTRY),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(REPO_ENTRY),
    getDefaultRepo: vi.fn().mockReturnValue(REPO_ENTRY),
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
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = makeReview();
      store.artifacts.push(makeArtifact(store, "Review", 1, review));
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

  const deps = {
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
  };

  return {
    store,
    deps,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    executorAgent,
    reviewerAgent,
    logger,
  };
}

// ---------------------------------------------------------------------------
// runExecution
// ---------------------------------------------------------------------------

describe("OrchestratorService.runExecution", () => {
  it("commits a WIP checkpoint, runs the executor, records EXECUTION_FINISHED, and cascades into runReview", async () => {
    const initialRun = makeRun();
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    const report = makeExecutionReport();
    queueExecutorResult(h, report, 77);
    queueReviewerResult(h, makeReview({ overallVerdict: "approved" }));

    const result = await svc.runExecution("run-1");

    expect(h.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );
    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    expect(h.store.run.prNumber).toBe(77);
    expect(h.store.run.executorRuntime).toBe("claude-code");

    const eventTypes = h.store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    const comment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain("Execution Report");

    // Cascaded into runReview -> approved -> ReadyForHumanReview.
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does not attempt a git checkpoint commit when the run has no branch name", async () => {
    const initialRun = makeRun({ branchName: null });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    queueExecutorResult(h, makeExecutionReport(), 5);
    queueReviewerResult(h, makeReview({ overallVerdict: "approved" }));

    await svc.runExecution("run-1");

    expect(h.gitService.assertBranch).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("recovers a stranded execution: skips the executor and jumps straight to review when an ExecutionReport already exists with no matching EXECUTION_FINISHED", async () => {
    const initialRun = makeRun({ prNumber: 99 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    // Simulate: EXECUTION_STARTED recorded, then the process crashed after the
    // ExecutionReport artifact was written but before EXECUTION_FINISHED fired.
    h.store.events.push({
      id: "e-started",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    h.store.artifacts.push({
      id: "artifact-ExecutionReport-1",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      rawText: "{}",
      createdAt: new Date("2026-01-01T00:01:00Z"),
    });

    queueReviewerResult(h, makeReview({ overallVerdict: "approved" }));

    const result = await svc.runExecution("run-1");

    expect(h.executorAgent.run).not.toHaveBeenCalled();
    const finishedEvent = h.store.events.find((e) => e.eventType === RunEvent.EXECUTION_FINISHED);
    expect(finishedEvent).toBeDefined();
    expect((finishedEvent?.payloadJson as { recovered?: boolean })?.recovered).toBe(true);
    expect(result.state).toBe(RunState.ReadyForHumanReview);

    const warnCall = h.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Recovered stranded execution"),
    );
    expect(warnCall).toBeDefined();
  });

  it("does NOT trigger recovery when EXECUTION_FINISHED already fired after the existing report", async () => {
    const initialRun = makeRun({ prNumber: 99 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    h.store.artifacts.push({
      id: "artifact-ExecutionReport-1",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      rawText: "{}",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    h.store.events.push({
      id: "e-finished",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_FINISHED,
      source: "executor-agent",
      payloadJson: {},
      createdAt: new Date("2026-01-01T00:05:00Z"),
    });

    queueExecutorResult(h, makeExecutionReport({ executionVersion: 2 }), 99);
    queueReviewerResult(h, makeReview({ overallVerdict: "approved" }));

    await svc.runExecution("run-1");

    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("pauses the run on AgentTimeoutError, posts a comment, and does NOT cascade into review", async () => {
    const initialRun = makeRun();
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    h.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();

    const timeoutEvent = h.store.events.find((e) => e.eventType === "EXECUTION_TIMEOUT");
    expect(timeoutEvent).toBeDefined();
    expect((timeoutEvent?.payloadJson as { agent?: string })?.agent).toBe("executor");

    const comment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("timed out"),
    )?.[1] as string;
    expect(comment).toContain("10 minutes");
  });

  it("rethrows non-timeout errors from the executor agent", async () => {
    const initialRun = makeRun();
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    h.executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
    expect(h.store.run.state).toBe(RunState.Implementing);
  });

  it("throws a PolicyViolationError when the run is not in the Implementing state", async () => {
    const initialRun = makeRun({ state: RunState.Todo });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
    expect(h.executorAgent.run).not.toHaveBeenCalled();
  });

  it("renders a collapsed <details> file list and a Notes section when the report has many files and notes", async () => {
    const initialRun = makeRun();
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles, notes: ["Watch out for X"] });
    queueExecutorResult(h, report, 3);
    queueReviewerResult(h, makeReview({ overallVerdict: "approved" }));

    await svc.runExecution("run-1");

    const comment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain(`Files changed (${manyFiles.length})`);
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Watch out for X");
  });

  it("renders no files-changed section at all when the report changed no files", async () => {
    const initialRun = makeRun();
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    h.store.artifacts.push(makeArtifact(h.store, "Plan", 1, makePlan({ planVersion: 1 })));

    const report = makeExecutionReport({ filesChanged: [] });
    queueExecutorResult(h, report, 8);
    queueReviewerResult(h, makeReview({ overallVerdict: "approved" }));

    await svc.runExecution("run-1");

    const comment = h.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).not.toContain("### Files changed");
    expect(comment).not.toContain("<details>");
  });
});
