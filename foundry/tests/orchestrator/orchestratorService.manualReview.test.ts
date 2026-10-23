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
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
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

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: `artifact-${overrides.type}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

interface Store {
  run: Run;
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
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

  const githubClient = { getPRDiff: vi.fn() };

  const defaultRepoEntry = {
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
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
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
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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
      distillationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    planReviewerAgent,
    distillationAgent,
    logger,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: transitions back to AwaitingPlanApproval", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run };
    const plan = makePlan();
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(store);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan })) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);

    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into revision)", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run };
    const plan = makePlan();
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(store);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan })) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);

    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "bug", title: "t", details: "d" }],
      overallVerdict: "changes_requested",
    });

    const result = await svc.runManualReReview("run-1", { note: "double check auth" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { operatorNote: "double check auth" },
    );
  });

  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: Store = { run };
    const { deps, artifactRepo } = buildDeps(store);
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("records a RE_REVIEW_REQUESTED event carrying the trigger and note", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run };
    const plan = makePlan();
    const { deps, artifactRepo, planReviewerAgent, eventRepo } = buildDeps(store);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan })) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    await svc.runManualReReview("run-1", { note: "hi" });

    const call = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    );
    expect(call).toBeDefined();
    expect((call![0] as { payloadJson: { trigger: string; note: string } }).payloadJson).toEqual(
      expect.objectContaining({
        trigger: "re-review",
        note: "hi",
      }),
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: no revision needed, returns to AwaitingPlanApproval", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run };
    const plan = makePlan();
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(store);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan })) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: revises the plan via runPlanRevision", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run };
    const plan = makePlan();
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(store);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan })) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "bug", title: "t", details: "d" }],
      overallVerdict: "changes_requested",
    });

    const revisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue({ ...store.run, state: RunState.AwaitingPlanApproval });

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(revisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes undefined opts to runPlanRevision when no note is given on changes_requested", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: Store = { run };
    const plan = makePlan();
    const { deps, artifactRepo, planReviewerAgent } = buildDeps(store);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan })) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "needs work",
      findings: [],
      overallVerdict: "changes_requested",
    });

    const revisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue({ ...store.run, state: RunState.AwaitingPlanApproval });

    await svc.runManualPlanRevision("run-1");

    expect(revisionSpy).toHaveBeenCalledWith("run-1", undefined);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions HUMAN_APPROVED to Done, and posts the completion comment", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const store: Store = { run };
    const { deps, linearClient, distillationAgent } = buildDeps(store);
    (deps.gitService as { resolveMainRepoPath: ReturnType<typeof vi.fn> }).resolveMainRepoPath.mockReturnValue(
      "/tmp",
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Done"));
  });

  it("continues (best-effort) when the distillation agent throws", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const store: Store = { run };
    const { deps, logger, distillationAgent } = buildDeps(store);
    (deps.gitService as { resolveMainRepoPath: ReturnType<typeof vi.fn> }).resolveMainRepoPath.mockReturnValue(
      "/tmp",
    );
    distillationAgent.run.mockRejectedValue(new Error("distillation exploded"));
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("distillation exploded");
  });

  it("skips distillation entirely when no distillationAgent is configured", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const store: Store = { run };
    const { deps } = buildDeps(store, { distillationAgent: undefined });
    (deps.gitService as { resolveMainRepoPath: ReturnType<typeof vi.fn> }).resolveMainRepoPath.mockReturnValue(
      "/tmp",
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("cleans up the worktree when the run's workingDirectory differs from the main repo path", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree-1" });
    const store: Store = { run };
    const { deps } = buildDeps(store);
    (deps.gitService as { resolveMainRepoPath: ReturnType<typeof vi.fn> }).resolveMainRepoPath.mockReturnValue(
      "/tmp/main-repo",
    );
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(
      (deps.gitService as { removeWorktree: ReturnType<typeof vi.fn> }).removeWorktree,
    ).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree-1");
  });

  it("does not attempt worktree cleanup when workingDirectory already equals the main repo path", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/main-repo" });
    const store: Store = { run };
    const { deps } = buildDeps(store);
    (deps.gitService as { resolveMainRepoPath: ReturnType<typeof vi.fn> }).resolveMainRepoPath.mockReturnValue(
      "/tmp/main-repo",
    );
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(
      (deps.gitService as { removeWorktree: ReturnType<typeof vi.fn> }).removeWorktree,
    ).not.toHaveBeenCalled();
  });
});
