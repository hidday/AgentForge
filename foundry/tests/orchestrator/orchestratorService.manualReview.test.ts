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
    create: vi.fn().mockResolvedValue({}),
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
    linearClient,
    planReviewerAgent,
    planReviserAgent,
    distillationAgent,
    logger,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: transitions back to AwaitingPlanApproval", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Fine",
      overallVerdict: "approved",
      findings: [],
    });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", undefined);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into revision)", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Needs work",
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "nit", type: "style", title: "Nit", details: "minor" }],
    });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED (forced)

    const result = await svc.runManualReReview("run-1", { note: "please double-check" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", {
      operatorNote: "please double-check",
    });
  });

  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: no revision needed, stays in AwaitingPlanApproval", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Fine",
      overallVerdict: "approved",
      findings: [],
    });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: chains into runPlanRevision with the operator note", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const revisedPlan = makePlan({ planVersion: 2 });
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 })) // requireRun in runManualPlanRevision
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision, planVersion: 1 })); // requireRun in runPlanRevision
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Needs work",
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "risk", title: "Risk", details: "detail" }],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }] },
      revisedPlan,
    });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision })) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 })); // PLAN_REVISED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));

    const result = await svc.runManualPlanRevision("run-1", { note: "Focus on security" });

    // No PlanReview artifact was mocked, so runPlanRevision's own lookup
    // resolves it to undefined -- only the bundle, runId and operator note are
    // asserted precisely here.
    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, undefined, expect.anything(), "run-1", {
      operatorNote: "Focus on security",
    });
    const commentCalls = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls;
    expect(commentCalls.length).toBeGreaterThan(0);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, then transitions to Done and posts a comment", async () => {
    const { deps, runRepo, linearClient, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(result.state).toBe(RunState.Done);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[1] as string).includes("Done"),
    );
    expect(comment).toBeDefined();
  });

  it("swallows distillation agent errors (best-effort) and still completes the run", async () => {
    const { deps, runRepo, distillationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    distillationAgent.run.mockRejectedValue(new Error("distillation boom"));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation boom" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("skips distillation entirely when no distillationAgent dep is configured", async () => {
    const { deps, runRepo } = buildDeps({ distillationAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
