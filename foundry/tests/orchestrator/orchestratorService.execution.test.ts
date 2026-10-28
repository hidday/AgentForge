import { describe, it, expect, vi, afterEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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
    workingDirectory: "/tmp/work",
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
    summary: "Implemented",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
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

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function buildDeps(overrides: Record<string, unknown> = {}) {
  const repoEntry = {
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

  const runRepo = {
    findById: vi.fn(),
    update: vi.fn(),
    updateState: vi.fn(),
    findActiveByIssueId: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({}),
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
      description: "desc",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined) };

  const executorAgent = { run: vi.fn() };

  const gitService = {
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/work"),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
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
    plannerAgent: {},
    planReviewerAgent: {},
    planReviserAgent: {},
    executorAgent,
    reviewerAgent: {},
    remediationAgent: {},
    logger: noopLogger,
    ...overrides,
  };

  return {
    deps,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    executorAgent,
    gitService,
    githubSync,
  };
}

describe("OrchestratorService.approvePlan", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws when there is no Plan artifact for the run", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("sets approvedPlanVersion, transitions, and posts a plain comment without a note", async () => {
    const { deps, runRepo, linearClient } = buildDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, approvedPlanVersion: 1 });
    runRepo.updateState.mockResolvedValue({
      ...run,
      approvedPlanVersion: 1,
      state: RunState.Implementing,
    });
    const plan = makePlan({ planVersion: 1 });
    deps.artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ payloadJson: plan }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 1 });
    expect(result.state).toBe(RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v1 approved. Starting implementation...",
    );
  });

  it("includes the operator note in both the state-transition payload and the comment", async () => {
    const { deps, runRepo, linearClient, eventRepo } = buildDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Implementing });
    deps.artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ payloadJson: makePlan({ planVersion: 1 }) }),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "Looks good, proceed" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Looks good, proceed"),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({ note: "Looks good, proceed" }),
      }),
    );
  });
});

describe("OrchestratorService.runExecution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs the executor, persists the PR number, transitions, and proceeds to review", async () => {
    const { deps, runRepo, executorAgent } = buildDeps();
    const run = makeRun();
    runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(type === "Plan" ? makeArtifact({ payloadJson: makePlan() }) : null),
    );
    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 7 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 7 });
    runRepo.updateState.mockResolvedValue({ ...run, prNumber: 7, state: RunState.AIReview });

    const svc = new OrchestratorService(deps as never);
    const runReview = vi.spyOn(svc, "runReview").mockResolvedValue({ ...run, state: RunState.AIReview });

    const result = await svc.runExecution("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", {
      prNumber: 7,
      executorRuntime: "claude-code",
    });
    expect(runReview).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AIReview);
  });

  it("commits a WIP checkpoint before running the executor when the run has a branch", async () => {
    const { deps, runRepo, executorAgent, gitService } = buildDeps();
    const run = makeRun({ branchName: "ai/run-1" });
    runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(type === "Plan" ? makeArtifact({ payloadJson: makePlan() }) : null),
    );
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 7 });
    runRepo.update.mockResolvedValue({ ...run, prNumber: 7 });
    runRepo.updateState.mockResolvedValue({ ...run, prNumber: 7, state: RunState.AIReview });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/work", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalled();
  });

  it("blocks the run and comments when the executor times out", async () => {
    const { deps, runRepo, executorAgent, linearClient } = buildDeps();
    const run = makeRun();
    runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(type === "Plan" ? makeArtifact({ payloadJson: makePlan() }) : null),
    );
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 3_600_000));
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIBlocked });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out after 60 minutes"),
    );
  });

  it("rethrows a non-timeout error from the executor agent", async () => {
    const { deps, runRepo, executorAgent } = buildDeps();
    const run = makeRun();
    runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      Promise.resolve(type === "Plan" ? makeArtifact({ payloadJson: makePlan() }) : null),
    );
    executorAgent.run.mockRejectedValue(new Error("unexpected failure"));

    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("unexpected failure");
  });

  it("recovers a stranded execution (report exists but EXECUTION_FINISHED was never recorded)", async () => {
    const { deps, runRepo, executorAgent, eventRepo } = buildDeps();
    const run = makeRun({ prNumber: 9 });
    runRepo.findById.mockResolvedValue(run);
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      payloadJson: makeExecutionReport(),
      createdAt: new Date("2026-01-01T00:10:00Z"),
    });
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "EXECUTION_STARTED",
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:05:00Z"),
      },
    ]);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIReview });

    const svc = new OrchestratorService(deps as never);
    const runReview = vi.spyOn(svc, "runReview").mockResolvedValue({ ...run, state: RunState.AIReview });

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(runReview).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AIReview);
  });

  it("does not take the recovery shortcut when EXECUTION_FINISHED already fired after the report", async () => {
    const { deps, runRepo, executorAgent, eventRepo } = buildDeps();
    const run = makeRun({ prNumber: 9 });
    runRepo.findById.mockResolvedValue(run);
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      payloadJson: makeExecutionReport(),
      createdAt: new Date("2026-01-01T00:05:00Z"),
    });
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "EXECUTION_STARTED",
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:01:00Z"),
      },
      {
        id: "e2",
        runId: "run-1",
        eventType: "EXECUTION_FINISHED",
        source: "executor-agent",
        payloadJson: {},
        createdAt: new Date("2026-01-01T00:10:00Z"),
      },
    ]);
    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 9 });
    runRepo.update.mockResolvedValue({ ...run });
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AIReview });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue({ ...run, state: RunState.AIReview });

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });
});
