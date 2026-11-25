import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
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
    summary: "Did the thing",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
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
    eventType: "EXECUTION_STARTED",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function buildDeps() {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
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
        maxFilesChanged: 50,
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    executorAgent,
    reviewerAgent,
    githubSync,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("runs the executor, persists prNumber, transitions to AIReview, and proceeds to review", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, executorAgent, gitService } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun();
    const plan = makePlan();
    // Use >8 files and some notes to exercise the collapsed-file-list and
    // notes-section branches of formatExecutionReportComment.
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles, notes: ["Watch out for X"] });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 7 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));

    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    const startedEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_STARTED,
    );
    expect(startedEvent).toBeDefined();
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { prNumber: 7, executorRuntime: "claude-code" });

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("Files changed (9)");
    expect(comment![1]).toContain("<details>");
    expect(comment![1]).toContain("Watch out for X");

    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("skips gitService checkpoint commit when the run has no branchName yet", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ branchName: null });
    const plan = makePlan();
    const report = makeExecutionReport();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 7 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("throws via the policy engine when execution is attempted outside Implementing", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.Planning });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));

    await expect(svc.runExecution("run-1")).rejects.toThrow(
      /Cannot execute when run is in state/,
    );
  });

  it("recovers a stranded execution: an ExecutionReport exists with no EXECUTION_FINISHED event, so it skips the executor and goes straight to review", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ prNumber: 5 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      payloadJson: report,
      createdAt: new Date("2024-01-01T00:00:10Z"),
    });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });
    // EXECUTION_STARTED fired before the report; EXECUTION_FINISHED never fired.
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({
        eventType: RunEvent.EXECUTION_STARTED,
        createdAt: new Date("2024-01-01T00:00:00Z"),
      }),
    ]);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 5 }));

    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    const recoveredEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(recoveredEvent).toBeDefined();
    expect((recoveredEvent![0] as { payloadJson: { recovered?: boolean } }).payloadJson.recovered).toBe(true);
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("does NOT take the recovery shortcut when EXECUTION_FINISHED already fired after the report", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ prNumber: 5 });
    const plan = makePlan();
    const report = makeExecutionReport();
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      payloadJson: report,
      createdAt: new Date("2024-01-01T00:00:10Z"),
    });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: new Date("2024-01-01T00:00:00Z") }),
      makeEvent({ eventType: RunEvent.EXECUTION_FINISHED, createdAt: new Date("2024-01-01T00:00:20Z") }),
    ]);
    executorAgent.run.mockResolvedValue({ report, prNumber: 5 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 5 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 5 }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("handles an AgentTimeoutError from the executor by blocking the run and posting a timeout comment", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun();
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 3_600_000));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    const timeoutEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
    );
    expect(timeoutEvent).toBeDefined();
    const blockedEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(blockedEvent).toBeDefined();
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out after 60 minutes"),
    );
  });

  it("rethrows a non-timeout error from the executor", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun();
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("propagates a PolicyViolationError when the executor touches a protected path", async () => {
    const { deps, runRepo, artifactRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun();
    const plan = makePlan();
    const report = makeExecutionReport({ filesChanged: ["secrets/leak.ts"] });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    (deps.repoRegistry.getRepoByName as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["secrets/"],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 50,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 9 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 9 });

    await expect(svc.runExecution("run-1")).rejects.toThrow(/protected path/);
  });
});

describe("OrchestratorService.runReview", () => {
  it("transitions to ReadyForHumanReview (via markReady) when the reviewer approves", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AIReview, prNumber: 3 });
    const plan = makePlan();
    const execReport = makeExecutionReport();
    const review = makeReview({ overallVerdict: "approved" });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: execReport }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 3 }));

    const result = await svc.runReview("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { reviewerRuntime: "codex" });
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("posts review findings to GitHub and triggers remediation when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AIReview, prNumber: 3 });
    const plan = makePlan();
    const execReport = makeExecutionReport();
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "Bug", details: "details" },
      ],
    });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: execReport }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 101]]));
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: 3 }));

    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      3,
      review.findings,
      "changes_requested",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI Code Review"),
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 101 });
  });

  it("skips posting review findings to GitHub when there are no findings", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AIReview, prNumber: 3 });
    const plan = makePlan();
    const execReport = makeExecutionReport();
    const review = makeReview({ overallVerdict: "changes_requested", findings: [] });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: execReport }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("fetches the diff via githubClient when the run has a PR", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AIReview, prNumber: 3 });
    const plan = makePlan();
    const execReport = makeExecutionReport();
    const review = makeReview({ overallVerdict: "approved" });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: execReport }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      return Promise.resolve(null);
    });
    reviewerAgent.run.mockResolvedValue(review);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runReview("run-1");

    expect(deps.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 3);
    expect(reviewerAgent.run).toHaveBeenCalledWith(plan, execReport, "diff", expect.anything(), "run-1");
  });

  it("throws via the policy engine when there is no execution report to review", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AIReview, prNumber: 3 });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot review without/);
  });
});
