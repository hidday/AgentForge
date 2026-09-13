import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid work",
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
    id: "evt-1",
    runId: "run-1",
    eventType: "EXECUTION_STARTED",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
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
      maxFilesChanged: 100,
      maxDiffLines: 5000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
  };
}

function buildDeps(overrides: {
  run?: Run;
  plan?: Plan;
  existingReport?: Artifact | null;
  events?: RunEventRecord[];
} = {}) {
  const run = overrides.run ?? makeRun();
  const plan = overrides.plan ?? makePlan({ planVersion: run.approvedPlanVersion ?? 1 });
  const planArtifact = makeArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan });

  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) =>
      Promise.resolve({ ...run, state }),
    ),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) =>
      Promise.resolve({ ...run, ...patch }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      if (type === "ExecutionReport") {
        return Promise.resolve(
          overrides.existingReport === undefined ? null : overrides.existingReport,
        );
      }
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue(overrides.events ?? []),
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
  };

  const githubClient = { getPRDiff: vi.fn() };
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
        maxFilesChanged: 100,
        maxDiffLines: 5000,
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
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = {
    run: vi.fn().mockResolvedValue({ report: makeExecutionReport(), prNumber: 101 }),
  };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
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
    run,
    plan,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    executorAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws via policy when run is not Implementing", async () => {
    const { deps } = buildDeps({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("skips the executor and recovers when a stranded ExecutionReport is found", async () => {
    const run = makeRun({ prNumber: 55 });
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      createdAt: new Date("2024-01-01T00:05:00Z"),
    });
    const startedEvent = makeEvent({
      eventType: RunEvent.EXECUTION_STARTED as string,
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });
    const { deps, executorAgent } = buildDeps({
      run,
      existingReport: reportArtifact,
      events: [startedEvent],
    });
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
  });

  it("does NOT recover (runs executor normally) when EXECUTION_FINISHED already followed the report", async () => {
    const run = makeRun({ prNumber: 55 });
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      createdAt: new Date("2024-01-01T00:05:00Z"),
    });
    const startedEvent = makeEvent({
      eventType: RunEvent.EXECUTION_STARTED as string,
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });
    const finishedEvent = makeEvent({
      eventType: RunEvent.EXECUTION_FINISHED as string,
      createdAt: new Date("2024-01-01T00:10:00Z"),
    });
    const { deps, executorAgent } = buildDeps({
      run,
      existingReport: reportArtifact,
      events: [startedEvent, finishedEvent],
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("does not attempt recovery when the run has no prNumber even if a report exists", async () => {
    const run = makeRun({ prNumber: null });
    const reportArtifact = makeArtifact({
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
    });
    const { deps, executorAgent } = buildDeps({ run, existingReport: reportArtifact });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(run);

    await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("commits a WIP checkpoint before executing when the run has a branch", async () => {
    const { deps, gitService } = buildDeps({ run: makeRun({ branchName: "ai/run-1" }) });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );
  });

  it("skips the WIP checkpoint when the run has no branch yet", async () => {
    const { deps, gitService } = buildDeps({ run: makeRun({ branchName: null }) });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("on success: persists prNumber, transitions EXECUTION_FINISHED, posts a report comment, and proceeds to review", async () => {
    const report = makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"] });
    const { deps, executorAgent, runRepo, linearClient } = buildDeps();
    (executorAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({ report, prNumber: 202 });
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 202, executorRuntime: "claude-code" }),
    );
    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    const reportComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(reportComment).toBeDefined();
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("passes operatorNote through to the executor when provided", async () => {
    const { deps, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1", { note: "please hurry" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "please hurry" },
    );
  });

  it("throws PolicyViolationError (and does not transition) when the executor touches a protected path", async () => {
    const run = makeRun();
    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport({ filesChanged: ["secrets/creds.ts"] });
    const { deps, runRepo } = buildDeps({ run, plan });
    // Override protected paths via repoRegistry -> buildTaskBundle uses getRepoByName
    (deps.repoRegistry.getRepoByName as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["secrets/"],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 100,
        maxDiffLines: 5000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    (deps.executorAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      report,
      prNumber: 303,
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);

    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).not.toContain(RunEvent.EXECUTION_FINISHED);
    // prNumber was still persisted before the path check ran
    expect(runRepo.update).toHaveBeenCalledWith("run-1", expect.objectContaining({ prNumber: 303 }));
  });

  describe("AgentTimeoutError handling", () => {
    it("blocks the run, records EXECUTION_TIMEOUT, posts a comment, and does not rethrow", async () => {
      const timeoutError = new AgentTimeoutError("executor", 600_000);
      const { deps, executorAgent, linearClient, runRepo } = buildDeps();
      (executorAgent.run as ReturnType<typeof vi.fn>).mockRejectedValue(timeoutError);
      const svc = new OrchestratorService(deps as never);

      const result = await svc.runExecution("run-1");

      expect(result).toBeDefined();
      const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain("EXECUTION_TIMEOUT");
      expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
      const timeoutComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("timed out"),
      );
      expect(timeoutComment).toBeDefined();
      expect(timeoutComment![1]).toContain("10 minutes");
    });

    it("rethrows non-timeout errors from the executor", async () => {
      const boom = new Error("executor exploded");
      const { deps, executorAgent } = buildDeps();
      (executorAgent.run as ReturnType<typeof vi.fn>).mockRejectedValue(boom);
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runExecution("run-1")).rejects.toThrow("executor exploded");
    });
  });

  describe("execution report comment formatting", () => {
    it("collapses the files-changed section into <details> when more than 8 files changed", async () => {
      const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
      const report = makeExecutionReport({ filesChanged: manyFiles, notes: ["Heads up: big diff"] });
      const { deps, executorAgent, linearClient } = buildDeps();
      (executorAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({ report, prNumber: 404 });
      const svc = new OrchestratorService(deps as never);
      vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.runExecution("run-1");

      const reportComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
      )![1] as string;
      expect(reportComment).toContain("<details>");
      expect(reportComment).toContain("Files changed (9)");
      expect(reportComment).toContain("### Notes");
      expect(reportComment).toContain("Heads up: big diff");
    });

    it("lists files inline (no <details>) and omits the Notes section when there are none", async () => {
      const report = makeExecutionReport({ filesChanged: ["src/only.ts"], notes: [] });
      const { deps, executorAgent, linearClient } = buildDeps();
      (executorAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({ report, prNumber: 405 });
      const svc = new OrchestratorService(deps as never);
      vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.runExecution("run-1");

      const reportComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
      )![1] as string;
      expect(reportComment).not.toContain("<details>");
      expect(reportComment).toContain("Files changed (1)");
      expect(reportComment).not.toContain("### Notes");
    });
  });
});
