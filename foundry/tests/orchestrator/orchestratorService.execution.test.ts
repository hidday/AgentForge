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
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
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

function makeCheck(status: "pass" | "fail" | "skip" = "pass") {
  return { status, details: "" };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Executed",
    filesChanged: ["src/a.ts"],
    checks: { lint: makeCheck(), typecheck: makeCheck(), tests: makeCheck() },
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

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: RunEvent.EXECUTION_STARTED,
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  } as RunEventRecord;
}

const issueFixture = {
  id: "LIN-1",
  identifier: "ENG-1",
  title: "Test issue",
  description: "desc",
  branchName: "ai/run-1",
  labels: [] as string[],
  priority: 0,
  url: null,
};

function buildDeps(overrides: Record<string, unknown> = {}, initialRun: Run = makeRun()) {
  let current: Run = initialRun;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(current)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      current = { ...current, state };
      return Promise.resolve(current);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      current = { ...current, ...patch };
      return Promise.resolve(current);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue(issueFixture),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: undefined, blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };

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
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = {
    run: vi.fn().mockResolvedValue({ report: makeExecutionReport(), prNumber: 7 }),
  };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn(),
    resolveMainRepoPath: vi.fn(),
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
    executorAgent,
    gitService,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("throws via policy when the run is not Implementing", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.Planning }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("happy path: checkpoints the branch, runs the executor, and delegates to runReview", async () => {
    const { deps, runRepo, gitService, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    const run = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/work", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/work",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    expect(runRepo.update).toHaveBeenCalledWith("run-1", {
      prNumber: 7,
      executorRuntime: "claude-code",
    });
    expect(linearClient.postComment).toHaveBeenCalled();
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(run).toBeDefined();
  });

  it("skips the branch checkpoint when the run has no branchName", async () => {
    const { deps, gitService } = buildDeps({}, makeRun({ branchName: null }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("passes operatorNote to the executor agent when opts.note is given", async () => {
    const { deps, executorAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1", { note: "be careful with migrations" });

    expect(executorAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.anything(),
      { operatorNote: "be careful with migrations" },
    );
  });

  it("throws (propagates) when assertExecutorPaths rejects the executor's changes", async () => {
    const { deps, executorAgent } = buildDeps();
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["secrets/key.pem"] }),
      prNumber: 7,
    });
    const bundleAwareDeps = deps as unknown as { repoRegistry: { getRepoByName: ReturnType<typeof vi.fn> } };
    bundleAwareDeps.repoRegistry.getRepoByName.mockReturnValue({
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
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  describe("crash-recovery (stranded ExecutionReport)", () => {
    it("skips re-running the executor and jumps to review when the report postdates the last start with no later finish", async () => {
      const { deps, artifactRepo, eventRepo, executorAgent } = buildDeps(
        {},
        makeRun({ prNumber: 7 }),
      );
      const started = makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: new Date("2024-01-01T00:00:00Z") });
      const reportCreatedAt = new Date("2024-01-01T00:05:00Z");
      artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        if (type === "ExecutionReport")
          return Promise.resolve(
            makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport(), createdAt: reportCreatedAt }),
          );
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([started]);

      const svc = new OrchestratorService(deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.runExecution("run-1");

      expect(executorAgent.run).not.toHaveBeenCalled();
      expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    });

    it("re-runs the executor normally when EXECUTION_FINISHED already followed the stranded report", async () => {
      const { deps, artifactRepo, eventRepo, executorAgent } = buildDeps(
        {},
        makeRun({ prNumber: 7 }),
      );
      const reportCreatedAt = new Date("2024-01-01T00:05:00Z");
      const started = makeEvent({ eventType: RunEvent.EXECUTION_STARTED, createdAt: new Date("2024-01-01T00:00:00Z") });
      const finished = makeEvent({
        eventType: RunEvent.EXECUTION_FINISHED,
        createdAt: new Date("2024-01-01T00:10:00Z"),
      });
      artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        if (type === "ExecutionReport")
          return Promise.resolve(
            makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport(), createdAt: reportCreatedAt }),
          );
        return Promise.resolve(null);
      });
      eventRepo.findByRunId.mockResolvedValue([started, finished]);

      const svc = new OrchestratorService(deps as never);
      vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalled();
    });

    it("does not treat an existing report as stranded when the run has no PR yet", async () => {
      const { deps, artifactRepo, executorAgent } = buildDeps({}, makeRun({ prNumber: null }));
      artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        if (type === "ExecutionReport")
          return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
        return Promise.resolve(null);
      });

      const svc = new OrchestratorService(deps as never);
      vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalled();
    });
  });

  describe("executor timeout handling", () => {
    it("blocks the run, records an EXECUTION_TIMEOUT event, and posts a comment instead of throwing", async () => {
      const { deps, eventRepo, linearClient, executorAgent } = buildDeps();
      executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
      const svc = new OrchestratorService(deps as never);

      const run = await svc.runExecution("run-1");

      expect(run.state).toBe(RunState.AIBlocked);
      const timeoutEvent = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
      );
      expect(timeoutEvent).toBeDefined();
      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("timed out after 10 minutes"),
      );
    });

    it("re-throws non-timeout errors from the executor agent", async () => {
      const { deps, executorAgent } = buildDeps();
      executorAgent.run.mockRejectedValue(new Error("boom"));
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
    });
  });
});
