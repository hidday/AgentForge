import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/x",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 0,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
}): Artifact {
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

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
  events: { eventType: string; source: string; payloadJson?: unknown }[];
}

function buildDeps(store: TestStore, initialRun: Run, opts: { activeRun?: Run | null } = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn().mockImplementation(() => Promise.resolve(opts.activeRun ?? null)),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      Object.assign(initialRun, data);
      return Promise.resolve({ ...initialRun, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }) => {
      const a = asArtifact({
        type: params.type,
        version: params.version,
        payloadJson: params.payloadJson,
      });
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
    create: vi.fn().mockImplementation((params: { eventType: string; source: string; payloadJson?: unknown }) => {
      store.events.push(params);
      return Promise.resolve({ id: `event-${store.events.length}` });
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
      url: "https://linear.app/x",
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/repos/test-repo"),
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
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  // The real PlannerAgent/PlanReviewerAgent persist their own Plan/PlanReview
  // artifacts as a side effect of run(); replicate that here so downstream
  // orchestrator methods (which re-fetch the latest artifact) see them.
  let plannerPlanToReturn: Plan = makePlan();
  const plannerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const plan = plannerPlanToReturn;
      await artifactRepo.create({
        runId: initialRun.id,
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: JSON.stringify(plan),
      });
      return plan;
    }),
  };

  let planReviewToReturn: PlanReview = makePlanReview();
  const planReviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const planReview = planReviewToReturn;
      await artifactRepo.create({
        runId: initialRun.id,
        type: "PlanReview",
        version: 1,
        payloadJson: planReview,
        rawText: JSON.stringify(planReview),
      });
      return planReview;
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    githubClient,
    plannerAgent,
    planReviewerAgent,
    gitService,
    repoRegistry,
    dashboardEmitter,
    logger,
    setPlannerPlan: (plan: Plan) => {
      plannerPlanToReturn = plan;
    },
    setPlanReview: (review: PlanReview) => {
      planReviewToReturn = review;
    },
  };
}

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command payloads with a command to handleCommand", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" },
    });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does not call handleCommand when comment.command has no command payload", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it.each(["issue.created", "issue.updated"])(
    "is a no-op for %s actions (no run lookups triggered)",
    async (action) => {
      const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
      const built = buildDeps(store, makeRun());
      const svc = new OrchestratorService(built.deps as never);

      await svc.handleLinearWebhook({ action, issueId: "LIN-1" });

      expect(built.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
    },
  );
});

describe("OrchestratorService.handleCommand", () => {
  it.each(["ai-plan", "run-ai"] as const)("dispatches %s to startRun", async (type) => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type });

    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  describe("approve-plan", () => {
    it("approves the plan and runs execution when an active run exists", async () => {
      const activeRun = makeRun({ state: RunState.AwaitingPlanApproval });
      const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
      const built = buildDeps(store, activeRun, { activeRun });
      const svc = new OrchestratorService(built.deps as never);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(activeRun);
      const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).toHaveBeenCalledWith(activeRun.id);
      expect(runExecutionSpy).toHaveBeenCalledWith(activeRun.id);
    });

    it("does nothing when there is no active run for the issue", async () => {
      const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
      const built = buildDeps(store, makeRun(), { activeRun: null });
      const svc = new OrchestratorService(built.deps as never);
      const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approvePlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("reject-plan", () => {
    it("rejects the plan with the command body and source 'linear' when an active run exists", async () => {
      const activeRun = makeRun({ state: RunState.AwaitingPlanApproval });
      const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], events: [] };
      const built = buildDeps(store, activeRun, { activeRun });
      const svc = new OrchestratorService(built.deps as never);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "please redo step 2" });

      expect(rejectPlanSpy).toHaveBeenCalledWith(activeRun.id, "please redo step 2", "linear");
    });

    it("does nothing when there is no active run", async () => {
      const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
      const built = buildDeps(store, makeRun(), { activeRun: null });
      const svc = new OrchestratorService(built.deps as never);
      const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "reject-plan" });

      expect(rejectPlanSpy).not.toHaveBeenCalled();
    });
  });

  describe("re-review", () => {
    it("runs review when an active run exists", async () => {
      const activeRun = makeRun({ state: RunState.AIReview });
      const store: TestStore = { runState: RunState.AIReview, artifacts: [], events: [] };
      const built = buildDeps(store, activeRun, { activeRun });
      const svc = new OrchestratorService(built.deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(activeRun);

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).toHaveBeenCalledWith(activeRun.id);
    });

    it("does nothing when there is no active run", async () => {
      const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
      const built = buildDeps(store, makeRun(), { activeRun: null });
      const svc = new OrchestratorService(built.deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(runReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe("pause-ai / resume-ai", () => {
    it("pause-ai transitions the active run to AIBlocked via BLOCKED event", async () => {
      const activeRun = makeRun({ state: RunState.Todo });
      const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
      const built = buildDeps(store, activeRun, { activeRun });
      const svc = new OrchestratorService(built.deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(store.runState).toBe(RunState.AIBlocked);
      expect(store.events.map((e) => e.eventType)).toContain(RunEvent.BLOCKED);
    });

    it("pause-ai does nothing when there is no active run", async () => {
      const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
      const built = buildDeps(store, makeRun(), { activeRun: null });
      const svc = new OrchestratorService(built.deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(store.events).toHaveLength(0);
    });

    it("resume-ai transitions a blocked run back to Todo via RESET_TO_TODO", async () => {
      const activeRun = makeRun({ state: RunState.AIBlocked });
      const store: TestStore = { runState: RunState.AIBlocked, artifacts: [], events: [] };
      const built = buildDeps(store, activeRun, { activeRun });
      const svc = new OrchestratorService(built.deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(store.runState).toBe(RunState.Todo);
      expect(store.events.map((e) => e.eventType)).toContain(RunEvent.RESET_TO_TODO);
    });

    it("resume-ai does nothing when there is no active run", async () => {
      const store: TestStore = { runState: RunState.AIBlocked, artifacts: [], events: [] };
      const built = buildDeps(store, makeRun({ state: RunState.AIBlocked }), { activeRun: null });
      const svc = new OrchestratorService(built.deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(store.events).toHaveLength(0);
    });
  });

  it("logs a warning and takes no action for an unknown command", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

    expect(built.logger.warn).toHaveBeenCalled();
    expect(built.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without re-planning when one already exists for the issue", async () => {
    const activeRun = makeRun({ id: "run-existing", state: RunState.Planning });
    const store: TestStore = { runState: RunState.Planning, artifacts: [], events: [] };
    const built = buildDeps(store, activeRun, { activeRun });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result.id).toBe("run-existing");
    expect(built.linearClient.getIssue).not.toHaveBeenCalled();
    expect(built.plannerAgent.run).not.toHaveBeenCalled();
  });

  it("creates a run, plans, and proceeds to plan review when there are no blocking questions", async () => {
    const initialRun = makeRun({ state: RunState.Todo, planVersion: 0 });
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const built = buildDeps(store, initialRun, { activeRun: null });
    built.setPlannerPlan(makePlan({ planVersion: 1, openQuestions: [] }));
    built.setPlanReview(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(built.gitService.setupRunWorktree).toHaveBeenCalled();
    expect(built.dashboardEmitter.emitRunCreated).toHaveBeenCalled();
    expect(built.plannerAgent.run).toHaveBeenCalledTimes(1);
    expect(built.planReviewerAgent.run).toHaveBeenCalledTimes(1);

    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the plan has blocking open questions, without invoking plan review", async () => {
    const initialRun = makeRun({ state: RunState.Todo, planVersion: 0 });
    const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
    const built = buildDeps(store, initialRun, { activeRun: null });
    built.setPlannerPlan(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which API key?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toEqual([
      RunEvent.RUN_REQUESTED,
      RunEvent.PLAN_CREATED,
      RunEvent.NEEDS_HUMAN_CLARIFICATION,
    ]);
  });

  describe("buildTaskBundle default branch resolution", () => {
    it("uses the remote GitHub default branch when it differs from the configured value", async () => {
      const initialRun = makeRun({ state: RunState.Todo, planVersion: 0 });
      const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
      const built = buildDeps(store, initialRun, { activeRun: null });
      built.githubClient.getDefaultBranch.mockResolvedValue("develop");
      built.setPlannerPlan(makePlan({ planVersion: 1, openQuestions: [] }));
      built.setPlanReview(makePlanReview());
      const svc = new OrchestratorService(built.deps as never);

      await svc.startRun("LIN-1");

      const bundleArg = built.plannerAgent.run.mock.calls[0]?.[0];
      expect(bundleArg.repo.defaultBranch).toBe("develop");
      expect(built.logger.warn).toHaveBeenCalled();
    });

    it("falls back to the configured default branch when GitHub lookup throws", async () => {
      const initialRun = makeRun({ state: RunState.Todo, planVersion: 0 });
      const store: TestStore = { runState: RunState.Todo, artifacts: [], events: [] };
      const built = buildDeps(store, initialRun, { activeRun: null });
      built.githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub API down"));
      built.setPlannerPlan(makePlan({ planVersion: 1, openQuestions: [] }));
      built.setPlanReview(makePlanReview());
      const svc = new OrchestratorService(built.deps as never);

      const result = await svc.startRun("LIN-1");

      const bundleArg = built.plannerAgent.run.mock.calls[0]?.[0];
      expect(bundleArg.repo.defaultBranch).toBe("main");
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      expect(built.logger.warn).toHaveBeenCalled();
    });
  });
});
