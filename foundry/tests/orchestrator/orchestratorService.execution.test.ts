import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";
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
    notes: ["Note one"],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation.",
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, initialRun: Run) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, fields: Partial<Run>) =>
      Promise.resolve({ ...initialRun, ...fields, state: store.runState }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
    }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { eventType: string }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: "run-1",
        eventType: params.eventType,
        source: "test",
        payloadJson: {},
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
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

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn().mockReturnValue({
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    executorAgent,
    reviewerAgent,
    planReviewerAgent,
    planReviserAgent,
    gitService,
    linearClient,
    logger,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("checkpoints the branch, runs the executor, records EXECUTION_FINISHED, and delegates to runReview", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", prNumber: null });
    const { deps, executorAgent, gitService, eventRepo, runRepo, linearClient } = buildDeps(
      store,
      initialRun,
    );
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi
      .spyOn(svc, "runReview")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const report = makeExecutionReport();
    executorAgent.run.mockResolvedValue({ report, prNumber: 55 });

    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint"),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.EXECUTION_STARTED }),
    );
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 55, executorRuntime: "claude-code" }),
    );
    expect(store.events.map((e) => e.eventType)).toContain(RunEvent.EXECUTION_FINISHED);
    expect(store.runState).toBe(RunState.AIReview);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AIReview);
  });

  it("does not checkpoint the branch when the run has no branchName", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: null });
    const { deps, executorAgent, gitService } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 10 });

    await svc.runExecution("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("recovers a stranded execution (ExecutionReport exists but EXECUTION_FINISHED was never recorded) without re-running the executor", async () => {
    const plan = makePlan({ planVersion: 1 });
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
    const report = makeExecutionReport();

    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        { ...asArtifact({ type: "ExecutionReport", version: 1, payloadJson: report }), createdAt: reportCreatedAt },
      ],
      events: [
        { id: "e1", runId: "run-1", eventType: RunEvent.EXECUTION_STARTED, source: "orchestrator", payloadJson: {}, createdAt: startedAt },
      ],
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1", prNumber: 77 });
    const { deps, executorAgent, eventRepo, logger } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi
      .spyOn(svc, "runReview")
      .mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const result = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", prNumber: 77 }),
      expect.stringContaining("Recovered stranded execution"),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.EXECUTION_FINISHED, payloadJson: expect.objectContaining({ recovered: true }) }),
    );
    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AIReview);
  });

  it("blocks the run and posts a comment when the executor agent times out", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const { deps, executorAgent, eventRepo, linearClient } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview");

    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));

    const result = await svc.runExecution("run-1");

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "EXECUTION_TIMEOUT",
        payloadJson: expect.objectContaining({ agent: "executor", timeoutMs: 600_000 }),
      }),
    );
    expect(store.runState).toBe(RunState.AIBlocked);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
    expect(runReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AIBlocked);
  });

  it("rethrows non-timeout executor errors without transitioning the run", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.Implementing, branchName: "ai/run-1" });
    const { deps, executorAgent } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
    expect(store.runState).toBe(RunState.Implementing);
  });
});

describe("OrchestratorService.runPlanReview changes_requested branch", () => {
  it("posts the review findings comment and chains into runPlanRevision, ending at AwaitingPlanApproval", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.PlanReview,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const { deps, planReviewerAgent, planReviserAgent, linearClient, runRepo } = buildDeps(
      store,
      initialRun,
    );
    const svc = new OrchestratorService(deps as never);

    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "Needs more detail",
      findings: [
        { id: "f1", severity: "important", title: "Missing step", details: "Add rollback plan" },
      ],
    });

    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Added rollback plan" }],
      },
      revisedPlan,
    });

    const result = await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan Revision Dispositions"),
    );
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("passes an operatorNote through to the plan reviser when opts.note is provided", async () => {
    const plan = makePlan({ planVersion: 1 });
    const review = { overallVerdict: "changes_requested" as const, summary: "s", findings: [] };
    const store: TestStore = {
      runState: RunState.PlanRevision,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: review }),
      ],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const { deps, planReviserAgent } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan,
    });

    await svc.runPlanRevision("run-1", { note: "please tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      review,
      expect.anything(),
      "run-1",
      { operatorNote: "please tighten scope" },
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("records approvedPlanVersion, transitions to Implementing, and includes the operator note in the comment", async () => {
    const plan = makePlan({ planVersion: 3 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 3, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });
    const { deps, runRepo, linearClient } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approvePlan("run-1", { note: "go ahead" });

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("go ahead"),
    );
    expect(result.state).toBe(RunState.Implementing);
  });

  it("posts a plain approval comment when no operator note is given", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, linearClient } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.not.stringContaining("operator note"),
    );
  });
});
