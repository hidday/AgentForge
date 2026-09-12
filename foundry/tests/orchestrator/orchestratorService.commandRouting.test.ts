import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
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

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
}

function buildDeps(store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = makeArtifact({ type: params.type as Artifact["type"], version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
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
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff") };

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
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    logger,
    executorAgent,
    reviewerAgent,
  };
}

describe("OrchestratorService -- accessor getters", () => {
  it("exposes the injected repositories and clients unchanged", () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
    // agentSkillRepo was never provided in deps -> undefined
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("no-ops on issue.created", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, runRepo } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("no-ops on issue.updated", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, runRepo } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("delegates to handleCommand on comment.command when a command is present", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, logger } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "unknown" } as never,
    });

    // handleCommand logs "Processing command" then handles "unknown" with a warn
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });

  it("does not call handleCommand on comment.command with no command payload", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, logger } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  it("logs a warning for an unknown command type", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, logger } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" } as never);

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "LIN-1", command: { type: "unknown" } },
      "Unknown command received",
    );
  });

  it("routes ai-plan and run-ai to startRun (returns existing active run without re-planning)", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Planning }), artifacts: [] };
    const { deps, runRepo, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "ai-plan" } as never);
    await svc.handleCommand("LIN-1", { type: "run-ai" } as never);

    // Both commands should have triggered startRun's active-run lookup.
    expect(runRepo.findActiveByIssueId).toHaveBeenCalledTimes(2);
    // Since an active run already exists, startRun should short-circuit and never
    // re-fetch the Linear issue or post a "planning started" comment.
    expect(linearClient.getIssue).not.toHaveBeenCalled();
    expect(linearClient.postComment).not.toHaveBeenCalled();
  });

  it("pause-ai transitions an active run to AIBlocked via BLOCKED/user-command", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Todo }), artifacts: [] };
    const { deps, eventRepo, runRepo } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AIBlocked);
    const call = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.BLOCKED,
    );
    expect(call).toBeDefined();
    expect((call![0] as { source: string }).source).toBe("user-command");
  });

  it("pause-ai is a no-op when there is no active run", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, runRepo } = buildDeps(store);
    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("resume-ai transitions an active run from AIBlocked back to Todo via RESET_TO_TODO", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.AIBlocked }), artifacts: [] };
    const { deps, eventRepo, runRepo } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Todo);
    const call = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RESET_TO_TODO,
    );
    expect(call).toBeDefined();
  });

  it("resume-ai is a no-op when there is no active run", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, runRepo } = buildDeps(store);
    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);

    expect(runRepo.updateState).not.toHaveBeenCalled();
  });

  it("reject-plan delegates to rejectPlan with the command body and 'linear' source", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [
        makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
      ],
    };
    const { deps, eventRepo, artifactRepo } = buildDeps(store);
    // Force the re-plan to have a blocking question so rejectPlan returns early
    // right after recording NEEDS_HUMAN_CLARIFICATION (keeps the test focused on routing).
    (deps.plannerAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "please redo" } as never);

    const rejectionArtifact = (artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "RejectionContext",
    );
    expect(rejectionArtifact).toBeDefined();
    expect(
      (rejectionArtifact![0] as { payloadJson: { source: string; feedback: string } }).payloadJson
        .source,
    ).toBe("linear");
    expect(
      (rejectionArtifact![0] as { payloadJson: { feedback: string } }).payloadJson.feedback,
    ).toBe("please redo");

    const rejectedEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_REJECTED,
    );
    expect(rejectedEvent).toBeDefined();
  });

  it("reject-plan is a no-op when there is no active run", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, eventRepo } = buildDeps(store);
    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" } as never);

    expect(eventRepo.create).not.toHaveBeenCalled();
  });

  it("re-review is a no-op when there is no active run", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, reviewerAgent } = buildDeps(store);
    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "re-review" } as never);

    expect(reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("re-review routes to runReview, which rejects via policy when the run is not in AIReview", async () => {
    // The active run is in Planning, so runReview's assertCanReview guard should
    // reject before ever invoking the reviewer agent -- proving the routing
    // reaches runReview without duplicating runReview's full happy-path tests.
    const store: TestStore = { run: makeRun({ state: RunState.Planning }), artifacts: [] };
    const { deps, reviewerAgent } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.handleCommand("LIN-1", { type: "re-review" } as never)).rejects.toMatchObject(
      { rule: "review_requires_ai_review_state" },
    );
    expect(reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("approve-plan is a no-op when there is no active run", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps, executorAgent } = buildDeps(store);
    (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);

    expect(executorAgent.run).not.toHaveBeenCalled();
  });

  it("approve-plan calls approvePlan then runExecution for the active run", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    };
    const { deps, eventRepo, executorAgent } = buildDeps(store);
    // Short-circuit the deep execution pipeline via an agent timeout so the test
    // stays focused on proving handleCommand chains approvePlan -> runExecution.
    executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 60_000));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);
    void result;

    const approvedEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect(approvedEvent).toBeDefined();

    const startedEvent = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_STARTED,
    );
    expect(startedEvent).toBeDefined();

    expect(store.run.state).toBe(RunState.AIBlocked);
  });
});

describe("OrchestratorService.startRun -- existing active run", () => {
  it("returns the existing active run without re-planning", async () => {
    const activeRun = makeRun({ id: "run-existing", state: RunState.Planning });
    const store: TestStore = { run: activeRun, artifacts: [] };
    const { deps, linearClient } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result.id).toBe("run-existing");
    expect(result.state).toBe(RunState.Planning);
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });
});
