import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError, AgentTimeoutError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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
    summary: "Implemented.",
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

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp/worktree",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
  };
}

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
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

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
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
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    executorAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runExecution -- policy guards", () => {
  it("throws when the run is not in Implementing state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(asArtifact("Plan", 1, makePlan()));

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws when approvedPlanVersion is not set", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: null }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(asArtifact("Plan", 1, makePlan()));

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws when the approved plan version does not match the stored plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(
      asArtifact("Plan", 1, makePlan({ planVersion: 1 })),
    );

    try {
      await svc.runExecution("run-1");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
    }
  });
});

describe("OrchestratorService.runExecution -- crash recovery", () => {
  it("skips re-running the executor and jumps to review when an ExecutionReport exists after the last EXECUTION_STARTED with no EXECUTION_FINISHED", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, prNumber: 99 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue(run);

    const plan = makePlan();
    const report = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport")
        return Promise.resolve({ ...asArtifact("ExecutionReport", 1, report), createdAt: new Date(2024, 0, 2) });
      if (type === "Review") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date(2024, 0, 1),
      },
    ]);

    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 99 }));

    // Isolate runExecution's own recovery logic from the downstream review flow,
    // which is covered separately.
    const reviewSpy = vi
      .spyOn(svc, "runReview")
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 99 }));

    await svc.runExecution("run-1");

    // Executor must NOT have been invoked a second time.
    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith("run-1");

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
  });

  it("does NOT trigger recovery when EXECUTION_FINISHED already fired after the report", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, prNumber: 99 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 100 });

    const plan = makePlan();
    const oldReport = makeExecutionReport();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "ExecutionReport")
        return Promise.resolve({
          ...asArtifact("ExecutionReport", 1, oldReport),
          createdAt: new Date(2024, 0, 1),
        });
      return Promise.resolve(null);
    });

    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date(2023, 11, 31),
      },
      {
        id: "e2",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_FINISHED,
        source: "executor-agent",
        payloadJson: {},
        createdAt: new Date(2024, 0, 2),
      },
    ]);

    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ executionVersion: 2 }),
      prNumber: 100,
    });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 100 }));
    vi.spyOn(svc, "runReview").mockResolvedValue(
      makeRun({ state: RunState.AIReview, prNumber: 100 }),
    );

    await svc.runExecution("run-1");

    // Since EXECUTION_FINISHED already happened after the report, the executor runs again normally.
    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });
});

describe("OrchestratorService.runExecution -- executor timeout handling", () => {
  it("blocks the run and posts a comment when the executor agent times out", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "ExecutionReport") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    deps.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
    expect(eventTypes).toContain(RunEvent.BLOCKED);

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("timed out"),
    );
    expect(comment).toBeDefined();
  });

  it("re-throws non-timeout errors from the executor agent", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "ExecutionReport") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    deps.executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });
});

describe("OrchestratorService.runExecution -- executor path policy", () => {
  it("propagates a PolicyViolationError when the executor touches a protected path", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 5 });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "ExecutionReport") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    deps.repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["src/secure/"],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });

    deps.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["src/secure/keys.ts"] }),
      prNumber: 5,
    });

    try {
      await svc.runExecution("run-1");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
    }
  });
});

describe("OrchestratorService.runExecution -- happy path", () => {
  it("commits a WIP checkpoint, runs the executor, records EXECUTION_FINISHED, and proceeds to review", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 10 });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "ExecutionReport") return Promise.resolve(null);
      if (type === "Review") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    deps.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport(),
      prNumber: 10,
    });

    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 10 }));
    deps.reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const result = await svc.runExecution("run-1");

    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      run.workingDirectory,
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);

    expect(result).toBeDefined();
  });
});
