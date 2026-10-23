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

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: `artifact-${overrides.type}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> & { eventType: string }): RunEventRecord {
  return {
    id: `event-${Math.random()}`,
    runId: "run-1",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
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
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { eventType: string; source: string; payloadJson?: unknown }) => {
      const e = makeEvent({
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
      });
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
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff content") };

  const defaultRepoEntry = {
    name: "test-repo",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [] as string[],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
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
    githubSync,
    executorAgent,
    reviewerAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("runs the executor, commits a checkpoint, transitions to AIReview, and starts review", async () => {
    const run = makeRun({ branchName: "ai/run-1", prNumber: null });
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run, artifacts: [makeArtifact({ type: "Plan", payloadJson: plan })], events: [] };
    const { deps, runRepo, gitService, executorAgent, eventRepo, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const report = makeExecutionReport({ filesChanged: ["src/a.ts"], notes: ["note 1"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });

    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue({ ...store.run, state: RunState.AIReview });

    const result = await svc.runExecution("run-1");

    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      undefined,
    );
    const startedEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_STARTED,
    );
    expect(startedEvent).toBeDefined();
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { prNumber: 7, executorRuntime: "claude-code" });
    expect(result.state).toBe(RunState.AIReview);
    expect(reviewSpy).toHaveBeenCalledWith("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(commentCall).toBeDefined();
    expect(commentCall![1]).toContain("### Notes");
  });

  it("skips the checkpoint commit when the run has no branchName", async () => {
    const run = makeRun({ branchName: null, prNumber: null });
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run, artifacts: [makeArtifact({ type: "Plan", payloadJson: plan })], events: [] };
    const { deps, gitService, executorAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 3 });
    vi.spyOn(svc, "runReview").mockResolvedValue({ ...store.run, state: RunState.AIReview });

    await svc.runExecution("run-1");

    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("formats a collapsible file list when more than 8 files changed, and omits the files section when none changed", async () => {
    const run = makeRun({ branchName: "ai/run-1" });
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run, artifacts: [makeArtifact({ type: "Plan", payloadJson: plan })], events: [] };
    const { deps, executorAgent, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: manyFiles }),
      prNumber: 9,
    });
    vi.spyOn(svc, "runReview").mockResolvedValue({ ...store.run, state: RunState.AIReview });

    await svc.runExecution("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(commentCall![1]).toContain("<details>");
    expect(commentCall![1]).toContain("Files changed (9)");
  });

  it("omits the files-changed section entirely when the executor changed no files", async () => {
    const run = makeRun({ branchName: "ai/run-1" });
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run, artifacts: [makeArtifact({ type: "Plan", payloadJson: plan })], events: [] };
    const { deps, executorAgent, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: [] }),
      prNumber: 11,
    });
    vi.spyOn(svc, "runReview").mockResolvedValue({ ...store.run, state: RunState.AIReview });

    await svc.runExecution("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(commentCall![1]).not.toContain("Files changed");
  });

  it("recovers a stranded execution: skips the executor and transitions straight to review", async () => {
    const run = makeRun({ branchName: "ai/run-1", prNumber: 5 });
    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    const reportArtifact = makeArtifact({ type: "ExecutionReport", payloadJson: report });
    // Advance the artifact's createdAt so it is strictly after the EXECUTION_STARTED event.
    reportArtifact.createdAt = new Date(Date.now() + 1000);

    const startedEvent = makeEvent({ eventType: RunEvent.EXECUTION_STARTED });
    startedEvent.createdAt = new Date(Date.now() - 1000);

    const store: Store = {
      run,
      artifacts: [makeArtifact({ type: "Plan", payloadJson: plan }), reportArtifact],
      events: [startedEvent],
    };
    const { deps, executorAgent, eventRepo } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue({ ...store.run, state: RunState.AIReview });

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    const recoveredEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(recoveredEvent).toBeDefined();
    expect((recoveredEvent![0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered).toBe(true);
    expect(result.state).toBe(RunState.AIReview);
  });

  it("does NOT treat the execution as stranded when EXECUTION_FINISHED already fired after the report", async () => {
    const run = makeRun({ branchName: "ai/run-1", prNumber: 5 });
    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    const reportArtifact = makeArtifact({ type: "ExecutionReport", payloadJson: report });
    reportArtifact.createdAt = new Date(Date.now() - 2000);

    const startedEvent = makeEvent({ eventType: RunEvent.EXECUTION_STARTED });
    startedEvent.createdAt = new Date(Date.now() - 3000);
    const finishedEvent = makeEvent({ eventType: RunEvent.EXECUTION_FINISHED });
    finishedEvent.createdAt = new Date(Date.now() - 1000); // after the report

    const store: Store = {
      run,
      artifacts: [makeArtifact({ type: "Plan", payloadJson: plan }), reportArtifact],
      events: [startedEvent, finishedEvent],
    };
    const { deps, executorAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    executorAgent.run.mockResolvedValue({ report: makeExecutionReport({ executionVersion: 2 }), prNumber: 5 });
    vi.spyOn(svc, "runReview").mockResolvedValue({ ...store.run, state: RunState.AIReview });

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalled();
  });

  it("blocks the run when the executor times out, posts a comment, and does not proceed to review", async () => {
    const run = makeRun({ branchName: "ai/run-1" });
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run, artifacts: [makeArtifact({ type: "Plan", payloadJson: plan })], events: [] };
    const { deps, executorAgent, eventRepo, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
    const reviewSpy = vi.spyOn(svc, "runReview");

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(reviewSpy).not.toHaveBeenCalled();
    const timeoutEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();
    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("timed out"),
    );
    expect(commentCall).toBeDefined();
  });

  it("rethrows non-timeout errors from the executor", async () => {
    const run = makeRun({ branchName: "ai/run-1" });
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run, artifacts: [makeArtifact({ type: "Plan", payloadJson: plan })], events: [] };
    const { deps, executorAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("throws a PolicyViolationError when the executor touched a protected path", async () => {
    const run = makeRun({ branchName: "ai/run-1" });
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run, artifacts: [makeArtifact({ type: "Plan", payloadJson: plan })], events: [] };
    const { deps, executorAgent } = buildDeps(store);
    (deps.repoRegistry as { getRepoByName: ReturnType<typeof vi.fn> }).getRepoByName.mockReturnValue({
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
    const svc = new OrchestratorService(deps as never);

    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["protected/secret.ts"] }),
      prNumber: 1,
    });

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws a PolicyViolationError when the run is not in the Implementing state", async () => {
    const run = makeRun({ state: RunState.Planning });
    const store: Store = { run, artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(/Cannot execute/);
  });
});

describe("OrchestratorService.runReview", () => {
  it("approved verdict transitions to ReadyForHumanReview and calls markReady", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const store: Store = {
      run,
      artifacts: [
        makeArtifact({ type: "Plan", payloadJson: plan }),
        makeArtifact({ type: "ExecutionReport", payloadJson: report }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, githubClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue({ ...store.run });

    const result = await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 10);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("changes_requested verdict posts findings, transitions to AddressingReview, and calls runRemediation with the comment map", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const store: Store = {
      run,
      artifacts: [
        makeArtifact({ type: "Plan", payloadJson: plan }),
        makeArtifact({ type: "ExecutionReport", payloadJson: report }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, githubSync } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/a.ts", title: "t", details: "d" },
      ],
    });
    reviewerAgent.run.mockResolvedValue(review);
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 123]]));
    const remediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue({ ...store.run, state: RunState.AIReview });

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      10,
      review.findings,
      "changes_requested",
    );
    expect(remediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
    expect(result).toBeDefined();
  });

  it("does not call postReviewFindings when there are no findings", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const store: Store = {
      run,
      artifacts: [
        makeArtifact({ type: "Plan", payloadJson: plan }),
        makeArtifact({ type: "ExecutionReport", payloadJson: report }),
      ],
      events: [],
    };
    const { deps, reviewerAgent, githubSync } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved", findings: [] }));
    vi.spyOn(svc, "markReady").mockResolvedValue({ ...store.run });

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("throws a PolicyViolationError when the run is not in AIReview state", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const store: Store = { run, artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot review/);
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment and logs when all policy checks pass", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
    const report = makeExecutionReport();
    const review = makeReview({ overallVerdict: "approved" });
    const store: Store = {
      run,
      artifacts: [
        makeArtifact({ type: "ExecutionReport", payloadJson: report }),
        makeArtifact({ type: "Review", payloadJson: review }),
      ],
      events: [],
    };
    const { deps, linearClient, logger } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Run marked as ready for human review",
    );
    expect(result).toBeDefined();
  });

  it("throws when the execution report has failing checks", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "fail", details: "broken" },
      },
    });
    const review = makeReview({ overallVerdict: "approved" });
    const store: Store = {
      run,
      artifacts: [
        makeArtifact({ type: "ExecutionReport", payloadJson: report }),
        makeArtifact({ type: "Review", payloadJson: review }),
      ],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });
});
