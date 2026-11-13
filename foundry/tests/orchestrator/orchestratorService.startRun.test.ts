import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
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

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
}

function asArtifact(params: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${params.type}-${params.version}`,
    runId: "run-1",
    type: params.type as Artifact["type"],
    version: params.version,
    payloadJson: params.payloadJson,
    rawText: JSON.stringify(params.payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ ...initialRun, id, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((params: Record<string, unknown>) =>
      Promise.resolve({ ...initialRun, ...params }),
    ),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, params: Record<string, unknown>) =>
      Promise.resolve({ ...initialRun, ...params, state: store.runState }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact(params);
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/test-repo"),
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

  const plannerAgent = {
    run: vi.fn().mockImplementation(async (_bundle: unknown, _runId: string, opts?: { planVersionOverride?: number }) => {
      const plan = makePlan(opts?.planVersionOverride ? { planVersion: opts.planVersionOverride } : {});
      await artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: JSON.stringify(plan),
      });
      return plan;
    }),
  };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test1234" }),
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
    githubClient,
    plannerAgent,
    planReviewerAgent,
    dashboardEmitter,
    logger,
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const store: TestStore = { runState: RunState.Planning, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Planning });
    const built = buildDeps(store, initialRun);
    const activeRun = makeRun({ id: "existing-run", state: RunState.Planning });
    built.runRepo.findActiveByIssueId.mockResolvedValue(activeRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toBe(activeRun);
    expect(built.runRepo.create).not.toHaveBeenCalled();
  });

  it("full happy path: creates run, plans, reviews, and lands in AwaitingPlanApproval", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.dashboardEmitter.emitRunCreated).toHaveBeenCalledWith(
      "run-1",
      "LIN-1",
      "test-repo",
    );

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.RUN_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_APPROVED);

    const startedComment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI planning started"),
    );
    expect(startedComment).toBeDefined();

    const approvedComment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("approved"),
    );
    expect(approvedComment).toBeDefined();
  });

  it("uses GitHub's remote default branch and warns when it differs from config", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo });
    const built = buildDeps(store, initialRun);
    built.githubClient.getDefaultBranch.mockResolvedValue("trunk");

    const svc = new OrchestratorService(built.deps as never);
    await svc.startRun("LIN-1");

    const warnCall = built.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("differs from GitHub"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { remote: string }).remote).toBe("trunk");
  });

  it("falls back to the config default branch when GitHub lookup fails", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Todo });
    const built = buildDeps(store, initialRun);
    built.githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub API down"));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const warnCall = built.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" &&
        (c[1] as string).includes("Failed to resolve default branch"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("GitHub API down");
  });

  it("throws a PolicyViolationError when the run is not in a plannable state", async () => {
    // assertCanPlan is checked right after run creation; simulate a run that
    // somehow already left Todo/Planning (e.g. re-entrant call) by having the
    // repo return a run already in Implementing on create().
    const store: TestStore = { runState: RunState.Implementing, artifacts: [] };
    const initialRun = makeRun({ state: RunState.Implementing });
    const built = buildDeps(store, initialRun);
    built.runRepo.create.mockResolvedValue(initialRun);

    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.startRun("LIN-1")).rejects.toThrow(/Cannot plan when run is in state/);
  });
});
