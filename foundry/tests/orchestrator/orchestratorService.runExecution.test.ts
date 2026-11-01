import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
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
    workingDirectory: "/work",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(): Plan {
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
  };
}

function makeReport(overrides: Record<string, unknown> = {}) {
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
    score: 0.8,
    scoreRationale: "Solid.",
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
  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "title",
      description: "desc",
      branchName: "ai/run-1",
      state: "Implementing",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/work"),
  };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
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
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return {
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
  };
}

function spyBuildTaskBundle(svc: OrchestratorService) {
  return vi
    .spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle")
    .mockResolvedValue({
      issue: { id: "LIN-1", title: "title", description: "desc", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/work",
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
    });
}

describe("OrchestratorService.runExecution", () => {
  it("skips the git checkpoint commit when the run has no branchName", async () => {
    const deps = buildDeps();
    const run = makeRun({ branchName: null });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.executorAgent.run.mockResolvedValue({ report: makeReport(), prNumber: 42 });
    deps.runRepo.update.mockResolvedValue(makeRun({ branchName: null, prNumber: 42 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ branchName: null, state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    expect(deps.gitService.assertBranch).not.toHaveBeenCalled();
    expect(deps.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("checkpoints the branch via assertBranch + commitAndPush when branchName is set", async () => {
    const deps = buildDeps();
    const run = makeRun({ branchName: "ai/run-1" });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.executorAgent.run.mockResolvedValue({ report: makeReport(), prNumber: 42 });
    deps.runRepo.update.mockResolvedValue(makeRun({ prNumber: 42 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    expect(deps.gitService.assertBranch).toHaveBeenCalledWith("/work", "ai/run-1");
    expect(deps.gitService.commitAndPush).toHaveBeenCalledWith(
      "/work",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
  });

  it("recovers a stranded execution (ExecutionReport exists, EXECUTION_FINISHED never recorded) by skipping the executor and going straight to review", async () => {
    const deps = buildDeps();
    const run = makeRun({ prNumber: 42 });
    deps.runRepo.findById.mockResolvedValue(run);

    const reportArtifact = { payloadJson: makeReport(), createdAt: new Date("2024-01-01T12:00:00Z") };
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });
    deps.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED as string,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2024-01-01T11:00:00Z"),
      },
    ]);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    const result = await svc.runExecution("run-1");

    expect(deps.executorAgent.run).not.toHaveBeenCalled();
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.EXECUTION_FINISHED, payloadJson: expect.objectContaining({ recovered: true }) }),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does NOT recover when EXECUTION_FINISHED was already recorded after the report (no stranded execution)", async () => {
    const deps = buildDeps();
    const run = makeRun({ prNumber: 42 });
    deps.runRepo.findById.mockResolvedValue(run);

    const reportArtifact = { payloadJson: makeReport(), createdAt: new Date("2024-01-01T12:00:00Z") };
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "ExecutionReport") return Promise.resolve(reportArtifact);
      return Promise.resolve(null);
    });
    deps.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED as string,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date("2024-01-01T11:00:00Z"),
      },
      {
        id: "e2",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_FINISHED as string,
        source: "executor-agent",
        payloadJson: {},
        createdAt: new Date("2024-01-01T13:00:00Z"),
      },
    ]);
    deps.executorAgent.run.mockResolvedValue({ report: makeReport(), prNumber: 42 });
    deps.runRepo.update.mockResolvedValue(makeRun({ prNumber: 42 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    expect(deps.executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("on AgentTimeoutError: logs, records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a comment, and returns without calling runReview", async () => {
    const deps = buildDeps();
    const run = makeRun();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIBlocked }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    const result = await svc.runExecution("run-1");

    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "EXECUTION_TIMEOUT" }),
    );
    expect(result.state).toBe(RunState.AIBlocked);
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out after 10 minutes"),
    );
    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("rethrows non-timeout errors from the executor agent", async () => {
    const deps = buildDeps();
    const run = makeRun();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.executorAgent.run.mockRejectedValue(new Error("boom"));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("includes a Notes section in the posted execution-report comment when the report has notes", async () => {
    const deps = buildDeps();
    const run = makeRun();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.executorAgent.run.mockResolvedValue({
      report: makeReport({ notes: ["Discovered a flaky test in auth.spec.ts"] }),
      prNumber: 7,
    });
    deps.runRepo.update.mockResolvedValue(makeRun({ prNumber: 7 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    const comment = deps.linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("### Notes");
    expect(comment).toContain("- Discovered a flaky test in auth.spec.ts");
  });

  it("forwards opts.note as an operatorNote to the executor agent", async () => {
    const deps = buildDeps();
    const run = makeRun();
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.executorAgent.run.mockResolvedValue({ report: makeReport(), prNumber: 1 });
    deps.runRepo.update.mockResolvedValue(makeRun({ prNumber: 1 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1", { note: "Use feature flags" });

    const call = deps.executorAgent.run.mock.calls[0];
    expect(call[4]).toEqual({ operatorNote: "Use feature flags" });
  });
});
