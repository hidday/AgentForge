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
    prNumber: 12,
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

function buildDeps(overrides: Record<string, unknown> = {}) {
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
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
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
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
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
    gitService,
    logger,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: transitions to AwaitingPlanApproval via PLAN_REVIEW_APPROVED", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
  });

  it("changes_requested verdict: still ends up back at AwaitingPlanApproval (does not auto-chain into revision)", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "details" }],
    });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1", { note: "double check auth" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const transitionEvent = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    );
    expect((transitionEvent![0] as { payloadJson: { note: string } }).payloadJson.note).toBe(
      "double check auth",
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: transitions to AwaitingPlanApproval, does NOT call runPlanRevision", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: records PLAN_REVIEW_CHANGES_REQUESTED and delegates to runPlanRevision with the operator note", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "details" }],
    });
    runRepo.updateState.mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));

    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten validation" });

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten validation" });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, runRepo, linearClient, distillationAgent, gitService } = buildDeps();
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    gitService.resolveMainRepoPath.mockReturnValue("/main/repo");

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(run.linearIssueId, expect.stringContaining("Done"));
    // Done triggers worktree cleanup since mainRepoPath differs from workingDirectory
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/main/repo", run.workingDirectory);
  });

  it("continues (does not throw) and logs a warning when the distillation agent throws", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, runRepo, distillationAgent, logger } = buildDeps();
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("skips cleanupRunWorktree when mainRepoPath equals the run's workingDirectory", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/main/repo" });
    const { deps, runRepo, gitService } = buildDeps();
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/main/repo" }));
    gitService.resolveMainRepoPath.mockReturnValue("/main/repo");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });
});
