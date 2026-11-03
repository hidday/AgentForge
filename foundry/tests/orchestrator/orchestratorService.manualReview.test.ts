import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
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
    getRelatedContext: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

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
    planReviserAgent,
    distillationAgent,
    logger,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runManualReReview("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun());
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("approved verdict: transitions back to AwaitingPlanApproval (via PlanReview)", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValueOnce(planReviewRun).mockResolvedValueOnce(awaitingRun);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval without auto-chaining into revision", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValueOnce(planReviewRun).mockResolvedValueOnce(awaitingRun);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "t", details: "d" }],
    });

    const result = await svc.runManualReReview("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes an operatorNote through to the planReviewerAgent and into the transition payload", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.runManualReReview("run-1", { note: "double-check tests" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", {
      operatorNote: "double-check tests",
    });
    const reReviewEventCall = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "RE_REVIEW_REQUESTED",
    );
    expect(reReviewEventCall?.[0]).toMatchObject({
      payloadJson: expect.objectContaining({ trigger: "re-review", note: "double-check tests" }),
    });
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun());
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("approved verdict: transitions to AwaitingPlanApproval without revising", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    const result = await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: chains into runPlanRevision with the operator note", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const planRevisionRun = makeRun({ state: RunState.PlanRevision });
    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }))
      .mockResolvedValue(planRevisionRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(planRevisionRun) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(awaitingRun); // PLAN_REVISED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "t", details: "d" }],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      undefined,
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict without an operator note: chains into runPlanRevision with no note", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const planRevisionRun = makeRun({ state: RunState.PlanRevision });
    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }))
      .mockResolvedValue(planRevisionRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(planRevisionRun)
      .mockResolvedValueOnce(awaitingRun);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "t", details: "d" }],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, undefined, expect.anything(), "run-1", undefined);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.approveHumanReview("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("runs the distillation agent, transitions to Done, and posts the final comment", async () => {
    const { deps, runRepo, linearClient, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    const doneRun = makeRun({ state: RunState.Done });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(doneRun);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", readyRun);
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", "Human review approved. Run is **Done**.");
    expect(result.state).toBe(RunState.Done);
  });

  it("swallows a distillation agent failure (best-effort) and still completes the run", async () => {
    const { deps, runRepo, distillationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    const doneRun = makeRun({ state: RunState.Done });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(doneRun);
    distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));

    const result = await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("stringifies a non-Error distillation failure in the warning log", async () => {
    const { deps, runRepo, distillationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    const doneRun = makeRun({ state: RunState.Done });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(doneRun);
    distillationAgent.run.mockRejectedValue("a plain string failure");

    const result = await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "a plain string failure" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("completes the run when no distillationAgent is configured", async () => {
    const { deps, runRepo } = buildDeps({ distillationAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    const doneRun = makeRun({ state: RunState.Done });
    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(doneRun);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
