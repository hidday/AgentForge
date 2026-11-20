import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord, SkillDocument } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Some description text",
    linearIssueTitle: "Some title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 3,
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
    summary: "Implemented the thing.",
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

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown; id?: string }): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

// --- "rejectPlan"-flow deps, mirroring the established pattern in
// orchestratorService.rejectPlan.test.ts, used here to exercise
// buildTaskBundle / loadReplanContext / formatPlanReviewComment branches. ---
function buildRejectFlowDeps(overrides: Record<string, unknown> = {}) {
  const runInitial = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
  const runPlanning = makeRun({ state: RunState.Planning, planVersion: 2 });
  const runPlanReviewState = makeRun({ state: RunState.PlanReview, planVersion: 3 });
  const runAfterUpdate = makeRun({ state: RunState.Planning, planVersion: 3 });
  const runPlanRevisionState = makeRun({ state: RunState.PlanRevision, planVersion: 3 });
  const runAwaitingApproval = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 4 });

  const newPlan = makePlan({ planVersion: 3 });

  const runRepo = {
    // 1st call: rejectPlan's own requireRun. 2nd: runPlanReview's requireRun
    // (state should be PlanReview, after PLAN_CREATED). 3rd+: runPlanRevision's
    // requireRun, when the changes_requested branch chains into it (state
    // should be PlanRevision, after PLAN_REVIEW_CHANGES_REQUESTED).
    findById: vi
      .fn()
      .mockResolvedValueOnce(runInitial)
      .mockResolvedValueOnce(runPlanReviewState)
      .mockResolvedValue(runPlanRevisionState),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi
      .fn()
      .mockResolvedValueOnce(runPlanning) // PLAN_REJECTED
      .mockResolvedValueOnce(runPlanReviewState) // PLAN_CREATED
      .mockResolvedValueOnce(runPlanRevisionState) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(runAwaitingApproval), // PLAN_REVISED
    // 1st update() call: rejectPlan's own re-plan version bump (state still
    // Planning, before PLAN_CREATED). 2nd+: runPlanRevision's version bump
    // (state PlanRevision, when the changes_requested branch reaches it) --
    // update() only patches fields, it must not clobber state.
    update: vi
      .fn()
      .mockResolvedValueOnce(runAfterUpdate)
      .mockResolvedValue({ ...runPlanRevisionState, planVersion: 4 }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 3, payloadJson: newPlan }));
      return Promise.resolve(null);
    }),
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
      branchName: "hidday/lin-1-test-issue",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
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
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn().mockResolvedValue(newPlan) };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    }),
  };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 4 }),
    }),
  };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test1234" }),
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    logger,
  };
}

describe("OrchestratorService -- requireRun failure path", () => {
  it("throws 'Run not found' when the run does not exist", async () => {
    const { deps, runRepo } = buildRejectFlowDeps();
    runRepo.findById.mockReset();
    runRepo.findById.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.runPlanning("missing-run")).rejects.toThrow(/Run not found: missing-run/);
  });
});

describe("OrchestratorService -- buildTaskBundle default-branch resolution", () => {
  it("uses the remote default branch and warns when it differs from the configured one", async () => {
    const { deps, plannerAgent, logger } = buildRejectFlowDeps();
    (deps.githubClient.getDefaultBranch as ReturnType<typeof vi.fn>).mockResolvedValue("develop");

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    const passedBundle = plannerAgent.run.mock.calls[0][0];
    expect(passedBundle.repo.defaultBranch).toBe("develop");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("keeps the configured default branch when the remote value matches", async () => {
    const { deps, plannerAgent, logger } = buildRejectFlowDeps();
    (deps.githubClient.getDefaultBranch as ReturnType<typeof vi.fn>).mockResolvedValue("main");

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    const passedBundle = plannerAgent.run.mock.calls[0][0];
    expect(passedBundle.repo.defaultBranch).toBe("main");
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("falls back to the configured default branch when GitHub lookup throws", async () => {
    const { deps, plannerAgent, logger } = buildRejectFlowDeps();
    (deps.githubClient.getDefaultBranch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("GitHub unreachable"),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    const passedBundle = plannerAgent.run.mock.calls[0][0];
    expect(passedBundle.repo.defaultBranch).toBe("main");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "GitHub unreachable" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });
});

describe("OrchestratorService -- loadReplanContext (rejectPlan iterate mode)", () => {
  it("omits previousPlan/humanAnswers/researchedAnswers/planReviewFindings when no such artifacts exist", async () => {
    const { deps, plannerAgent } = buildRejectFlowDeps();
    // loadReplanContext's "Plan" lookup (the first one made, for previousPlan)
    // comes back empty; everything else (HumanAnswers, ResearchedAnswers,
    // PlanReview, RejectionContext) is empty throughout. A later "Plan" lookup
    // -- made by runPlanReview, after the (mocked) planner has "produced" a
    // plan -- still needs to resolve, so only the first "Plan" call is nulled.
    let planLookups = 0;
    (deps.artifactRepo.findLatestByType as ReturnType<typeof vi.fn>).mockImplementation(
      (_runId: string, type: string) => {
        if (type !== "Plan") return Promise.resolve(null);
        planLookups += 1;
        if (planLookups === 1) return Promise.resolve(null);
        return Promise.resolve(
          asArtifact({ type: "Plan", version: 3, payloadJson: makePlan({ planVersion: 3 }) }),
        );
      },
    );

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", undefined, "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({
        previousPlan: expect.anything(),
        humanFeedback: expect.anything(),
        humanAnswers: expect.anything(),
        researchedAnswers: expect.anything(),
        planReviewFindings: expect.anything(),
      }),
    );
  });

  it("does not load prior context at all in 'fresh' mode", async () => {
    const { deps, plannerAgent } = buildRejectFlowDeps();
    const findLatestByType = deps.artifactRepo.findLatestByType as ReturnType<typeof vi.fn>;

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    // loadReplanContext queries Plan/HumanAnswers/ResearchedAnswers/PlanReview;
    // in fresh mode none of those lookups should happen (only RejectionContext,
    // the Plan lookup inside runPlanReview, etc. may still occur).
    const typesQueried = findLatestByType.mock.calls.map((c: unknown[]) => c[1]);
    expect(typesQueried).not.toContain("HumanAnswers");
    expect(typesQueried).not.toContain("ResearchedAnswers");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({ previousPlan: expect.anything() }),
    );
  });
});

describe("OrchestratorService -- formatPlanReviewComment via runPlanReview changes_requested", () => {
  it("posts a 'Changes Requested' plan-review comment and chains into plan revision", async () => {
    const { deps, linearClient, planReviewerAgent } = buildRejectFlowDeps();
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs more detail",
      findings: [
        { id: "f1", severity: "important", type: "scope", title: "Missing step", details: "Add a rollback step", affectedStepId: "s1" },
      ],
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1");

    const comments = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    const reviewComment = comments.find((c) => c.includes("AI Plan Review"));
    expect(reviewComment).toBeDefined();
    expect(reviewComment).toContain("Changes Requested");
    expect(reviewComment).toContain("[IMPORTANT]");
    expect(reviewComment).toContain("(step s1)");
    expect(reviewComment).toContain("Needs more detail");

    // Chained through PlanRevision back to AwaitingPlanApproval
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

// --- store-based deps for execution-report formatter branches, skill
// retrieval, and skill-metrics update (transitionAndRecord's Done/Failed
// side effects). ---
interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildExecDeps(store: TestStore, initialRun: Run, agentSkillRepo?: Record<string, unknown>) {
  const run: Run = { ...initialRun, state: store.runState };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...run, state: store.runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      run.state = newState;
      return Promise.resolve({ ...run, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      Object.assign(run, patch);
      return Promise.resolve({ ...run, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson,
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
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
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

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
        maxFilesChanged: 50,
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
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = { reviewId: "rev-1", summary: "ok", findings: [], overallVerdict: "approved" as const };
      await artifactRepo.create({ runId: "run-1", type: "Review", version: 1, payloadJson: review, rawText: "{}" });
      return review;
    }),
  };
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
      ...(agentSkillRepo ? { agentSkillRepo } : {}),
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

function makeExecutionPlan(): Plan {
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

function makeExecRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("OrchestratorService -- formatExecutionReportComment branches (via runExecution)", () => {
  it("collapses the file list into <details> above the threshold, renders a 'skip' check icon, and includes notes", async () => {
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makeExecutionPlan() })],
      events: [],
    };
    const initialRun = makeExecRun();
    const { deps, executorAgent, linearClient } = buildExecDeps(store, initialRun);

    const report = makeExecutionReport({
      filesChanged: manyFiles,
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "skip", details: "not configured" },
        tests: { status: "fail", details: "1 failing" },
      },
      notes: ["Followed existing conventions.", "Left a TODO for later."],
    });
    executorAgent.run.mockImplementation(async () => {
      await deps.artifactRepo.create({ runId: "run-1", type: "ExecutionReport", version: 1, payloadJson: report, rawText: "{}" });
      return { report, prNumber: 7 };
    });

    const svc = new OrchestratorService(deps as never);
    // The crafted report has failing/skip checks, which means runReview's
    // chained markReady call fails its own policy check further downstream.
    // That is expected and irrelevant here: the Execution Report comment is
    // posted earlier in runExecution, before runReview is even invoked.
    try {
      await svc.runExecution("run-1");
    } catch {
      // ignore -- see comment above
    }

    const comments = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    const execComment = comments.find((c) => c.includes("Execution Report"));
    expect(execComment).toBeDefined();
    expect(execComment).toContain("<details>");
    expect(execComment).toContain(`Files changed (${manyFiles.length})`);
    expect(execComment).toContain(":heavy_minus_sign:"); // skip icon
    expect(execComment).toContain(":x:"); // fail icon
    expect(execComment).toContain(":white_check_mark:"); // pass icon
    expect(execComment).toContain("### Notes");
    expect(execComment).toContain("Followed existing conventions.");
  });

  it("omits the Files and Notes sections entirely when there are none", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makeExecutionPlan() })],
      events: [],
    };
    const initialRun = makeExecRun();
    const { deps, executorAgent, linearClient } = buildExecDeps(store, initialRun);

    const report = makeExecutionReport({ filesChanged: [], notes: [] });
    executorAgent.run.mockImplementation(async () => {
      await deps.artifactRepo.create({ runId: "run-1", type: "ExecutionReport", version: 1, payloadJson: report, rawText: "{}" });
      return { report, prNumber: 7 };
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    const comments = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    const execComment = comments.find((c) => c.includes("Execution Report"));
    expect(execComment).toBeDefined();
    expect(execComment).not.toContain("Files changed");
    expect(execComment).not.toContain("### Notes");
  });

  it("lists files inline (no <details>) at or below the collapse threshold", async () => {
    const fewFiles = ["src/a.ts", "src/b.ts"];
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makeExecutionPlan() })],
      events: [],
    };
    const initialRun = makeExecRun();
    const { deps, executorAgent, linearClient } = buildExecDeps(store, initialRun);

    const report = makeExecutionReport({ filesChanged: fewFiles });
    executorAgent.run.mockImplementation(async () => {
      await deps.artifactRepo.create({ runId: "run-1", type: "ExecutionReport", version: 1, payloadJson: report, rawText: "{}" });
      return { report, prNumber: 7 };
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    const comments = linearClient.postComment.mock.calls.map((c: unknown[]) => c[1] as string);
    const execComment = comments.find((c) => c.includes("Execution Report"));
    expect(execComment).toBeDefined();
    expect(execComment).not.toContain("<details>");
    expect(execComment).toContain("src/a.ts");
    expect(execComment).toContain("src/b.ts");
  });
});

describe("OrchestratorService -- retrieveSkillsForPlanning", () => {
  it("returns an empty array and skips skill lookup entirely when no agentSkillRepo is configured", async () => {
    const store: TestStore = {
      runState: RunState.Implementing,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makeExecutionPlan() })],
      events: [],
    };
    const initialRun = makeExecRun({ state: RunState.Todo });
    store.runState = RunState.Todo;
    const { deps, eventRepo } = buildExecDeps(store, initialRun);
    (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(initialRun);
    (deps.gitService.setupRunWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-test",
    });
    deps.plannerAgent.run.mockImplementation(async () => {
      const plan = makeExecutionPlan();
      await deps.artifactRepo.create({ runId: "run-1", type: "Plan", version: 1, payloadJson: plan, rawText: "{}" });
      return plan;
    });

    const svc = new OrchestratorService(deps as never);
    await svc.startRun("LIN-1");

    expect(deps.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ priorSkills: [] }),
    );
    const skillEvents = eventRepo.create.mock.calls.filter(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvents).toHaveLength(0);
  });

  it("records a SKILL_INJECTION event when the repo returns relevant skills", async () => {
    const skill: SkillDocument = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "Use OAuth2",
      description: "How to wire OAuth2",
      taskCategory: "auth",
      skillMarkdown: "# OAuth2",
      utilityScore: 0.8,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([skill]),
    };

    const store: TestStore = {
      runState: RunState.Todo,
      artifacts: [],
      events: [],
    };
    const initialRun = makeExecRun({ state: RunState.Todo });
    const { deps, eventRepo } = buildExecDeps(store, initialRun, agentSkillRepo);
    (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(initialRun);
    (deps.gitService.setupRunWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-test",
    });
    deps.plannerAgent.run.mockImplementation(async () => {
      const plan = makeExecutionPlan();
      await deps.artifactRepo.create({ runId: "run-1", type: "Plan", version: 1, payloadJson: plan, rawText: "{}" });
      return plan;
    });

    const svc = new OrchestratorService(deps as never);
    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", expect.stringContaining("title"), expect.any(Number));
    const skillEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(skillEvent).toBeDefined();
    expect((skillEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual(["skill-1"]);
  });
});

describe("OrchestratorService -- updateSkillMetrics (via transitionAndRecord Done/Failed side effect)", () => {
  it("is a no-op when no agentSkillRepo is configured, even on a terminal transition", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [],
    };
    const initialRun = makeExecRun({ state: RunState.ReadyForHumanReview });
    const { deps } = buildExecDeps(store, initialRun);
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    // No throw, no agentSkillRepo calls possible since none was injected --
    // the absence of a crash here is the assertion.
  });

  it("is a no-op when there are no SKILL_INJECTION events for the run", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [],
    };
    const initialRun = makeExecRun({ state: RunState.ReadyForHumanReview });
    const { deps } = buildExecDeps(store, initialRun, agentSkillRepo);
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("increments success and archives low-utility skills on a Done transition", async () => {
    const updatedSkill = { id: "skill-1", utilityScore: 0.1 };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-1", "skill-2"] },
          createdAt: new Date(),
        },
        {
          id: "e2",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-1"] }, // duplicate; must be deduped
          createdAt: new Date(),
        },
      ],
    };
    const initialRun = makeExecRun({ state: RunState.ReadyForHumanReview });
    const { deps } = buildExecDeps(store, initialRun, agentSkillRepo);
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2); // deduped, not 3
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });

  it("increments failure (not success) on a Failed transition, and logs a warning when the increment throws", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockRejectedValue(new Error("db unavailable")),
      archiveIfLowUtility: vi.fn(),
    };
    // Use the HumanClarificationNeeded -> Failed transition (CLARIFICATION_EXHAUSTED)
    // to reach a Failed terminal state without going through execution.
    const planWithBlocker = makeExecutionPlan();
    planWithBlocker.openQuestions = [{ id: "q1", question: "Still blocked?", requiredForExecution: true }];
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({
          type: "Plan",
          version: 1,
          payloadJson: planWithBlocker,
        }),
        asArtifact({
          type: "TaskBundle",
          version: 1,
          payloadJson: {
            issue: { id: "LIN-1", title: "title", description: "desc", labels: [], priority: 0 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/run-1",
              repoPath: "/tmp",
              allowedPaths: ["src/"],
              protectedPaths: [],
            },
            constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
            definitionOfDone: [],
          },
        }),
      ],
      events: [
        { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
        { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e4", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      ],
    };
    const initialRun = makeExecRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const { deps, logger } = buildExecDeps(store, initialRun, agentSkillRepo);
    const plan = makeExecutionPlan();
    plan.openQuestions = [{ id: "q1", question: "Still blocked?", requiredForExecution: true }];
    deps.plannerAgent.run.mockResolvedValue(plan);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db unavailable" }),
      "Failed to update skill metric",
    );
  });
});

describe("OrchestratorService -- cleanupRunWorktree", () => {
  it("does not remove the worktree when the run's workingDirectory already equals the main repo path", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      events: [],
    };
    // workingDirectory defaults to "/tmp" and gitService.resolveMainRepoPath
    // is mocked to also return "/tmp" -- the two paths are equal, so the
    // cleanup branch must be skipped.
    const initialRun = makeExecRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const { deps, gitService } = buildExecDeps(store, initialRun);
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });
});
