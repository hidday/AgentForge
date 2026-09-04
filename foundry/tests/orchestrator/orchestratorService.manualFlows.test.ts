import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

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
    state: RunState.AwaitingPlanApproval,
    planVersion: 1,
    approvedPlanVersion: null,
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

function buildDeps(
  store: TestStore,
  initialRun: Run,
  extraDeps: Record<string, unknown> = {},
) {
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

  const githubClient = { getPRDiff: vi.fn() };

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
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main-repo"),
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
      ...extraDeps,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    planReviewerAgent,
    planReviserAgent,
    linearClient,
    gitService,
    logger,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("forwards opts.note as an operatorNote to the plan reviewer and returns to AwaitingPlanApproval on approval", async () => {
    const plan = makePlan();
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "Fine", findings: [] });

    const result = await svc.runManualReReview("run-1", { note: "double-check the rollback step" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { operatorNote: "double-check the rollback step" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("calls the plan reviewer without operatorNote when no note is given", async () => {
    const plan = makePlan();
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "Fine", findings: [] });

    await svc.runManualReReview("run-1");

    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", undefined);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const plan = makePlan();
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    });

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: returns to AwaitingPlanApproval without triggering a revision", async () => {
    const plan = makePlan();
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "Fine", findings: [] });

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: drives a full revision cycle back to AwaitingPlanApproval, forwarding the operator note", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    const planReview = {
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };
    // The real PlanReviewerAgent persists a PlanReview artifact as a side effect;
    // replicate that here since the agent itself is mocked, so runPlanRevision
    // (invoked internally) can find it via findLatestByType.
    planReviewerAgent.run.mockImplementation(async () => {
      store.artifacts.push(asArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }));
      return planReview;
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runManualPlanRevision("run-1", { note: "keep it minimal" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "keep it minimal" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs the distillation agent best-effort, transitions to Done, posts the final comment, and cleans up the worktree", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" });
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const { deps, linearClient, gitService } = buildDeps(store, run, { distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(store.runState).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
    expect(result.state).toBe(RunState.Done);
  });

  it("swallows distillation agent failures and still completes the run", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation blew up")) };
    const { deps, logger } = buildDeps(store, run, { distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      expect.stringContaining("Distillation agent failed"),
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("works fine with no distillation agent configured", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps } = buildDeps(store, run);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("does not attempt to remove the worktree when the run's workingDirectory is already the main repo path", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], events: [] };
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/main-repo" });
    const { deps, gitService } = buildDeps(store, run);
    // resolveMainRepoPath already defaults to "/tmp/main-repo" in buildDeps.
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });
});
