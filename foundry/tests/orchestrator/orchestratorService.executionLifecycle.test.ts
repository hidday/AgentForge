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
    summary: "Implementation complete.",
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

function asArtifact(
  type: string,
  version: number,
  payloadJson: unknown,
  createdAt: Date = new Date(),
): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt,
  };
}

function asEvent(
  eventType: string,
  createdAt: Date,
  overrides: Partial<RunEventRecord> = {},
): RunEventRecord {
  return {
    id: `event-${eventType}-${createdAt.getTime()}`,
    runId: "run-1",
    eventType,
    source: "test",
    payloadJson: {},
    createdAt,
    ...overrides,
  };
}

interface TestStore {
  runState: RunState;
  patch: Partial<Run>;
}

function buildDeps(initialRun: Run, store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, ...store.patch, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, ...store.patch, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.patch = { ...store.patch, ...patch };
      return Promise.resolve({ ...initialRun, ...store.patch, state: store.runState });
    }),
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
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff content") };

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
    remediationAgent,
    gitService,
    githubSync,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws PolicyViolationError via assertCanExecute guard when the run is not Implementing", async () => {
    const initialRun = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    const store: TestStore = { runState: RunState.Planning, patch: {} };
    const { deps, artifactRepo } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, makePlan({ planVersion: 1 })) : null),
    );

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("runs the executor end-to-end: checkpoints, calls the executor, asserts paths, transitions, and chains into runReview", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const store: TestStore = { runState: RunState.Implementing, patch: {} };
    const { deps, artifactRepo, executorAgent, reviewerAgent, gitService, linearClient } =
      buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      // Before the executor runs, no ExecutionReport exists yet (so the crash-
      // recovery branch is skipped); runReview re-reads it afterwards, by which
      // point the (mocked) executor has produced one.
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, makeReview({ overallVerdict: "approved" })));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 101 });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
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
    const execComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(execComment).toBeDefined();
    expect(reviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("forwards an operator note to the executor agent", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const store: TestStore = { runState: RunState.Implementing, patch: {} };
    const { deps, artifactRepo, executorAgent, reviewerAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, makeReview({ overallVerdict: "approved" })));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 101 });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));

    await svc.runExecution("run-1", { note: "focus on perf" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "focus on perf" },
    );
  });

  it("recovers a stranded execution (ExecutionReport exists, EXECUTION_FINISHED never recorded) without re-running the executor", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: 55 });
    const store: TestStore = { runState: RunState.Implementing, patch: {} };
    const { deps, artifactRepo, eventRepo, executorAgent, reviewerAgent, logger } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
    const startedAt = new Date("2026-01-01T00:00:00Z"); // before the report

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, report, reportCreatedAt));
      if (type === "Review")
        return Promise.resolve(asArtifact("Review", 1, makeReview({ overallVerdict: "approved" })));
      return Promise.resolve(null);
    });
    // EXECUTION_STARTED before the report; no EXECUTION_FINISHED at all.
    eventRepo.findByRunId.mockResolvedValue([asEvent(RunEvent.EXECUTION_STARTED, startedAt)]);

    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(reviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.ReadyForHumanReview);

    const recoveryWarn = logger.warn.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Recovered stranded execution"),
    );
    expect(recoveryWarn).toBeDefined();
  });

  it("does NOT treat the run as stranded when EXECUTION_FINISHED was already recorded after the report", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: 55 });
    const store: TestStore = { runState: RunState.Implementing, patch: {} };
    const { deps, artifactRepo, eventRepo, executorAgent, reviewerAgent } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const existingReport = makeExecutionReport({ executionVersion: 1 });
    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const finishedAt = new Date("2026-01-01T00:10:00Z"); // after the report: NOT stranded

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport")
        return Promise.resolve(asArtifact("ExecutionReport", 1, existingReport, reportCreatedAt));
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      asEvent(RunEvent.EXECUTION_STARTED, startedAt),
      asEvent(RunEvent.EXECUTION_FINISHED, finishedAt),
    ]);

    const newReport = makeExecutionReport({ executionVersion: 2 });
    executorAgent.run.mockResolvedValue({ report: newReport, prNumber: 55 });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));

    // No Review artifact exists yet, so the downstream markReady call (reached
    // via the approved-verdict branch of runReview) is expected to throw --
    // that's fine, this test only targets the crash-recovery decision itself.
    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);

    // Since the run wasn't stranded, the executor must run normally.
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("on executor AgentTimeoutError: logs, records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and returns without reviewing", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const store: TestStore = { runState: RunState.Implementing, patch: {} };
    const { deps, artifactRepo, eventRepo, executorAgent, reviewerAgent, linearClient, logger } =
      buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(reviewerAgent.run).not.toHaveBeenCalled();

    const timeoutEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();

    const timeoutComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("timed out"),
    );
    expect(timeoutComment).toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("re-throws non-timeout errors from the executor agent", async () => {
    const initialRun = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    const store: TestStore = { runState: RunState.Implementing, patch: {} };
    const { deps, artifactRepo, executorAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );
    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("skips the git checkpoint commit when the run has no branchName", async () => {
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const store: TestStore = { runState: RunState.Implementing, patch: {} };
    const { deps, artifactRepo, executorAgent, reviewerAgent, gitService } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, makeReview({ overallVerdict: "approved" })));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 101 });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runReview", () => {
  it("approved verdict: transitions to ReadyForHumanReview via markReady and skips remediation", async () => {
    const initialRun = makeRun({
      state: RunState.AIReview,
      prNumber: 7,
      approvedPlanVersion: 1,
    });
    const store: TestStore = { runState: RunState.AIReview, patch: {} };
    const { deps, artifactRepo, reviewerAgent, remediationAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, makeReview({ overallVerdict: "approved" })));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));

    const result = await svc.runReview("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(remediationAgent.run).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: posts findings to GitHub, transitions to AddressingReview, and chains into runRemediation", async () => {
    const initialRun = makeRun({
      state: RunState.AIReview,
      prNumber: 7,
      approvedPlanVersion: 1,
    });
    const store: TestStore = { runState: RunState.AIReview, patch: {} };
    const { deps, artifactRepo, reviewerAgent, remediationAgent, githubSync, linearClient } =
      buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "Review")
        return Promise.resolve(
          asArtifact(
            "Review",
            1,
            makeReview({
              overallVerdict: "changes_requested",
              findings: [
                {
                  id: "f1",
                  severity: "important",
                  type: "bug",
                  file: "src/foo.ts",
                  title: "Bug",
                  details: "d",
                },
              ],
            }),
          ),
        );
      return Promise.resolve(null);
    });

    const changesRequestedReview = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/foo.ts",
          title: "Bug",
          details: "d",
        },
      ],
    });
    reviewerAgent.run.mockResolvedValue(changesRequestedReview);
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 123]]));
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [
        { findingId: "f1", status: "accepted", action: "Fixed", rationale: "Confirmed bug" },
      ],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    });

    // markReady (called at the tail of runRemediation) re-reads the latest Review
    // artifact, which this fake still reports as "changes_requested" (remediation
    // doesn't write a fresh approved Review here) -- so it throws on the verdict
    // check. That's a pre-existing orchestrator property, not something this test
    // is targeting; we only care that the changes_requested branch correctly
    // posted findings and chained into remediation before that point.
    let caught: PolicyViolationError | undefined;
    try {
      await svc.runReview("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("ready_requires_approved_verdict");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      7,
      changesRequestedReview.findings,
      "changes_requested",
    );
    expect(remediationAgent.run).toHaveBeenCalledTimes(1);
    const changesComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Changes Requested"),
    );
    expect(changesComment).toBeDefined();
  });

  it("does not call githubSync.postReviewFindings when there are no findings even with changes_requested", async () => {
    const initialRun = makeRun({
      state: RunState.AIReview,
      prNumber: 7,
      approvedPlanVersion: 1,
    });
    const store: TestStore = { runState: RunState.AIReview, patch: {} };
    const { deps, artifactRepo, reviewerAgent, remediationAgent, githubSync } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(
      makeReview({ overallVerdict: "changes_requested", findings: [] }),
    );
    remediationAgent.run.mockImplementation(() => {
      throw new PolicyViolationError("no review artifact", "remediate_requires_review");
    });

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("fetches the PR diff via githubClient.getPRDiff using the run's repo and prNumber", async () => {
    // Note: assertCanReview (called earlier in runReview) already requires
    // run.prNumber to be truthy, so the `run.prNumber ? ... : ""` fallback in
    // the diff-fetch line can never actually take its empty-string branch in
    // a successful call -- it's guarded by the policy check above it.
    const initialRun = makeRun({
      state: RunState.AIReview,
      prNumber: 99,
      approvedPlanVersion: 1,
    });
    const store: TestStore = { runState: RunState.AIReview, patch: {} };
    const { deps, artifactRepo, reviewerAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, report));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "Review") return Promise.resolve(asArtifact("Review", 1, makeReview({ overallVerdict: "approved" })));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));

    await svc.runReview("run-1");

    expect(deps.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 99);
    expect(reviewerAgent.run).toHaveBeenCalledWith(
      plan,
      report,
      "diff content",
      expect.anything(),
      "run-1",
    );
  });
});
