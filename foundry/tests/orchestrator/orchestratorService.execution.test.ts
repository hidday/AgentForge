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
    scoreRationale: "Clean implementation.",
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "SOME_EVENT",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Test issue",
      description: "Test description",
      url: "https://linear.app/ENG-1",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn(),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

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
      ...overrides,
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
  it("happy path: checkpoints the branch, runs the executor, records the PR, and delegates to runReview", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, gitService, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1, prNumber: null });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: plan })) : Promise.resolve(null),
    );

    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 77 });

    runRepo.update.mockResolvedValue({ ...run, prNumber: 77, executorRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 77 }));

    const finalRun = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, prNumber: 77 });
    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(finalRun);

    const result = await svc.runExecution("run-1");

    // Checkpoint commit before running the executor
    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );

    // EXECUTION_STARTED recorded before the executor call
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { existingBranch: "ai/run-1", existingPR: null },
      undefined,
    );

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { prNumber: 77, executorRuntime: "claude-code" });

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Execution Report"),
    );
    expect(comment).toBeDefined();

    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(finalRun);
  });

  it("posts the collapsed <details> file list and a Notes section when there are many changed files and notes", async () => {
    const { deps, runRepo, artifactRepo, linearClient, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles, notes: ["Follow-up needed for perf."] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 12 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 12 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Execution Report"),
    )![1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain(`Files changed (${manyFiles.length})`);
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Follow-up needed for perf.");
  });

  it("renders the neutral icon for a 'skip' check status in the execution report comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );

    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "skip", details: "no test runner configured" },
      },
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 14 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 14 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Execution Report"),
    )![1] as string;
    expect(comment).toContain(":heavy_minus_sign: **Tests**");
  });

  it("renders the failure icon for a 'fail' check status in the execution report comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );

    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "2 lint errors" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 15 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 15 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Execution Report"),
    )![1] as string;
    expect(comment).toContain(":x: **Lint**");
  });

  it("omits the files-changed section entirely when the executor changed no files", async () => {
    const { deps, runRepo, artifactRepo, linearClient, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );

    const report = makeExecutionReport({ filesChanged: [] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 13 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 13 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Execution Report"),
    )![1] as string;
    expect(comment).not.toContain("Files changed");
  });

  it("threads opts.note into the executor as an operatorNote", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: plan })) : Promise.resolve(null),
    );
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 5 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 5 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1", { note: "Prefer minimal diff" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { existingBranch: null, existingPR: null },
      { operatorNote: "Prefer minimal diff" },
    );
  });

  it("throws PolicyViolationError('execute_requires_implementing_state') when run is not Implementing", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("execute_requires_implementing_state");
    expect(executorAgent.run).not.toHaveBeenCalled();
  });

  it("throws PolicyViolationError('execute_plan_version_mismatch') when approvedPlanVersion doesn't match the latest plan", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 2, payloadJson: plan })) : Promise.resolve(null),
    );

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("execute_plan_version_mismatch");
    expect(executorAgent.run).not.toHaveBeenCalled();
  });

  it("on AgentTimeoutError from the executor: records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and does not call runReview", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIBlocked }));

    const reviewSpy = vi.spyOn(svc, "runReview");

    const result = await svc.runExecution("run-1");

    const timeoutEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();
    expect((timeoutEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
      agent: "executor",
      timeoutMs: 600_000,
    });

    const blockedEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(blockedEvent).toBeDefined();

    expect(result.state).toBe(RunState.AIBlocked);
    expect(reviewSpy).not.toHaveBeenCalled();

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("timed out"),
    );
    expect(comment).toBeDefined();
  });

  it("rethrows a non-timeout error from the executor without recording EXECUTION_FINISHED", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );
    executorAgent.run.mockRejectedValue(new Error("executor crashed"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("executor crashed");

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).not.toContain(RunEvent.EXECUTION_FINISHED);
  });

  it("throws PolicyViolationError('executor_touched_protected_path') when the executor modifies a protected path, without recording EXECUTION_FINISHED", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })) : Promise.resolve(null),
    );
    const badReport = makeExecutionReport({ filesChanged: ["secrets/keys.json"] });
    executorAgent.run.mockResolvedValue({ report: badReport, prNumber: 9 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 9 });

    let caught: PolicyViolationError | undefined;
    try {
      await svc.runExecution("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }

    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("executor_touched_protected_path");

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).not.toContain(RunEvent.EXECUTION_FINISHED);
  });

  it("stranded-execution recovery: skips the executor and finishes when a report exists without a matching EXECUTION_FINISHED", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1, prNumber: 55 });
    runRepo.findById.mockResolvedValue(run);

    const report = makeExecutionReport();
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: report,
      createdAt: new Date("2026-01-01T00:05:00Z"),
    });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });

    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: new Date("2026-01-01T00:00:00Z") }),
      // No EXECUTION_FINISHED after the report was written -- a crash occurred.
    ]);

    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 55 }));

    const finalRun = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, prNumber: 55 });
    const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(finalRun);

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();

    const recoveredEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(recoveredEvent).toBeDefined();
    expect((recoveredEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
      recovered: true,
    });

    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(finalRun);
  });

  it("does NOT take the recovery shortcut when EXECUTION_FINISHED was already recorded after the report (report is stale, re-runs executor)", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1, prNumber: 55 });
    runRepo.findById.mockResolvedValue(run);

    const report = makeExecutionReport();
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: report,
      createdAt: new Date("2026-01-01T00:05:00Z"),
    });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });

    // EXECUTION_FINISHED recorded AFTER the report -- the prior attempt completed
    // normally, this is a fresh retry rather than a crash-recovery scenario.
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: new Date("2026-01-01T00:00:00Z") }),
      makeEvent({ eventType: RunEvent.EXECUTION_FINISHED, createdAt: new Date("2026-01-01T00:10:00Z") }),
    ]);

    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 55 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 55 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 55 }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });
});
