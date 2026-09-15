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
    prNumber: 42,
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
    scoreRationale: "Looks solid.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found issues",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/foo.ts",
        title: "Bug",
        details: "Real issue",
      },
    ],
    overallVerdict: "changes_requested",
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
    create: vi.fn().mockResolvedValue({}),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map([["f1", 123]])),
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

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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
    remediationAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws a PolicyViolationError when the run is not Implementing", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    );

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("recovers a stranded execution: skips the executor and delegates straight to runReview", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(aiReviewRun);

    const implementingRun = makeRun({ state: RunState.Implementing, prNumber: 42 });

    runRepo.findById.mockResolvedValue(implementingRun);
    runRepo.updateState.mockResolvedValue(aiReviewRun);

    const plan = makePlan();
    const report = makeExecutionReport();
    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: report, createdAt: reportCreatedAt }),
        );
      return Promise.resolve(null);
    });

    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({
        eventType: RunEvent.EXECUTION_STARTED,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ]);

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    const recoveredCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect((recoveredCall![0] as { payloadJson: { recovered: boolean } }).payloadJson.recovered).toBe(
      true,
    );
    expect(result).toBe(aiReviewRun);
  });

  it("does NOT recover when EXECUTION_FINISHED already fired after the report was created", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 99 });
    vi.spyOn(svc, "runReview").mockResolvedValue(aiReviewRun);

    const implementingRun = makeRun({ state: RunState.Implementing, prNumber: 42 });
    runRepo.findById.mockResolvedValue(implementingRun);
    runRepo.update.mockResolvedValue({ ...implementingRun, prNumber: 99 });
    runRepo.updateState.mockResolvedValue(aiReviewRun);

    const plan = makePlan();
    const report = makeExecutionReport();
    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: report, createdAt: reportCreatedAt }),
        );
      return Promise.resolve(null);
    });

    // A finish event already exists AFTER the report was written -> not stranded.
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({
        eventType: RunEvent.EXECUTION_STARTED,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      makeEvent({
        eventType: RunEvent.EXECUTION_FINISHED,
        createdAt: new Date("2026-01-01T00:10:00Z"),
      }),
    ]);

    executorAgent.run.mockResolvedValue({ report, prNumber: 99 });

    await svc.runExecution("run-1");

    // Executor should run normally since recovery conditions were not met.
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("runs the executor, pushes a checkpoint commit, and delegates to runReview on success", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, gitService, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(aiReviewRun);

    const implementingRun = makeRun({ state: RunState.Implementing, prNumber: null });

    runRepo.findById.mockResolvedValue(implementingRun);
    runRepo.update.mockResolvedValue({ ...implementingRun, prNumber: 42 });
    runRepo.updateState.mockResolvedValue(aiReviewRun);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 42 });

    const result = await svc.runExecution("run-1", { note: "focus on perf" });

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
      { operatorNote: "focus on perf" },
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(aiReviewRun);
  });

  it("skips git checkpointing when the run has no branchName", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const implementingRun = makeRun({ state: RunState.Implementing, branchName: null, prNumber: null });
    runRepo.findById.mockResolvedValue(implementingRun);
    runRepo.update.mockResolvedValue({ ...implementingRun, prNumber: 42 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });

    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 42 });

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("handles executor timeout: blocks the run, records the timeout event, and stops the flow", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    const implementingRun = makeRun({ state: RunState.Implementing, prNumber: null });
    runRepo.findById.mockResolvedValue(implementingRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });

    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));

    const result = await svc.runExecution("run-1");

    expect(runReviewSpy).not.toHaveBeenCalled();
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
    expect(result.state).toBe(RunState.AIBlocked);
  });

  it("rethrows non-timeout errors from the executor", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const implementingRun = makeRun({ state: RunState.Implementing, prNumber: null });
    runRepo.findById.mockResolvedValue(implementingRun);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });

    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });
});

describe("OrchestratorService.runReview", () => {
  it("routes to remediation and passes along the posted-comment map when changes are requested", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const addressingRun = makeRun({ state: RunState.AddressingReview, prNumber: 42 });
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(addressingRun);

    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 42 });

    runRepo.findById.mockResolvedValue(aiReviewRun);
    runRepo.update.mockResolvedValue(aiReviewRun);
    runRepo.updateState.mockResolvedValue(addressingRun);

    const executionReport = makeExecutionReport();
    const plan = makePlan();
    const review = makeReview();

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: executionReport }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    reviewerAgent.run.mockResolvedValue(review);

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      review.findings,
      "changes_requested",
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
    expect(result).toBe(addressingRun);
  });

  it("marks ready when the review is approved (no remediation, no PR comment map)", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    const runRemediationSpy = vi.spyOn(svc, "runRemediation");

    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    const readyRun = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 42 });

    runRepo.findById.mockResolvedValue(aiReviewRun);
    runRepo.update.mockResolvedValue(aiReviewRun);
    runRepo.updateState.mockResolvedValue(readyRun);

    const executionReport = makeExecutionReport();
    const plan = makePlan();
    const approvedReview = makeReview({ overallVerdict: "approved", findings: [] });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: executionReport }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    reviewerAgent.run.mockResolvedValue(approvedReview);

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(runRemediationSpy).not.toHaveBeenCalled();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  // Note: runReview's `diff = run.prNumber ? getPRDiff() : ""` false branch is
  // unreachable through the public API — assertCanReview() (called just above it)
  // already throws PolicyViolationError("review_requires_pr") whenever prNumber is
  // falsy, so by the time the ternary runs, prNumber is always truthy. Covered
  // instead by the "throws ... when the run is not in AIReview" style check below
  // plus policyEngine's own tests for the prNumber precondition.

  it("throws a PolicyViolationError when the run is not in AIReview", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
    );

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("throws a PolicyViolationError via the policy engine when remediation preconditions are unmet", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("skips branch assertion when the run has no branchName, and skips GitHub sync when there is no PR", async () => {
    const { deps, runRepo, artifactRepo, gitService, remediationAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const addressingRun = makeRun({
      state: RunState.AddressingReview,
      branchName: null,
      prNumber: null,
    });
    runRepo.findById.mockResolvedValue(addressingRun);
    runRepo.update.mockResolvedValue({ ...addressingRun, remediationRuntime: "claude-code" });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: null }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: null }));

    const review = makeReview();
    const executionReport = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: executionReport }));
      return Promise.resolve(null);
    });

    remediationAgent.run.mockResolvedValue({
      resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "why" }],
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    });

    const result = await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result).toBeDefined();
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment when policy checks pass", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const aiReviewRun = makeRun({ state: RunState.AIReview, prNumber: 42 });
    runRepo.findById.mockResolvedValue(aiReviewRun);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Review")
        return Promise.resolve(
          makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "approved", findings: [] }) }),
        );
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result).toBe(aiReviewRun);
  });

  it("throws a PolicyViolationError when there is no PR", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });
});
