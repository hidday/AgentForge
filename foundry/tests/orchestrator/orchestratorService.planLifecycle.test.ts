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

function buildDeps() {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
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
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
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
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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
      distillationAgent,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    logger,
    planReviserAgent,
    planReviewerAgent,
    distillationAgent,
    dashboardEmitter,
  };
}

describe("OrchestratorService.approvePlan", () => {
  it("throws when no plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan({ planVersion: 2 });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));
    runRepo.update.mockResolvedValue({ ...run, approvedPlanVersion: 2 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }));

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v2 approved. Starting implementation...",
    );
    expect(result.state).toBe(RunState.Implementing);
  });

  it("includes the operator note in the approval comment and event payload when provided", async () => {
    const { deps, runRepo, artifactRepo, linearClient, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan({ planVersion: 1 });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    await svc.approvePlan("run-1", { note: "Skip the migration step for now" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Skip the migration step for now"),
    );
    const planApprovedEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect(planApprovedEvent).toBeDefined();
    expect((planApprovedEvent![0] as { payloadJson: { note?: string } }).payloadJson.note).toBe(
      "Skip the migration step for now",
    );
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps planVersion, transitions to AwaitingPlanApproval, and posts a combined comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Needs fixes",
      findings: [],
      overallVerdict: "changes_requested",
    };
    const revisedPlan = makePlan({ planVersion: 2 });

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview") return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "fixed" }] },
      revisedPlan,
    });
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const result = await svc.runPlanRevision("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan Revision Dispositions"),
    );
    expect(result.planVersion).toBe(2);
  });

  it("forwards opts.note to the reviser as operatorNote", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.PlanRevision });
    const plan = makePlan();
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Needs fixes",
      findings: [],
      overallVerdict: "changes_requested",
    };

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview") return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanRevision("run-1", { note: "focus on security" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "focus on security" },
    );
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("transitions to AwaitingPlanApproval via PLAN_REVIEW_APPROVED when the reviewer approves", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED

    const result = await svc.runManualReReview("run-1");

    expect(runRepo.updateState).toHaveBeenNthCalledWith(2, "run-1", RunState.AwaitingPlanApproval);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "needs fixes",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "x", details: "y" }],
    });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runManualReReview("run-1");

    expect(runRepo.updateState).toHaveBeenNthCalledWith(2, "run-1", RunState.AwaitingPlanApproval);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(null);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("passes opts.note through as an operatorNote on the reviewer call and transition payload", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED

    await svc.runManualReReview("run-1", { note: "double-check the schema" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { operatorNote: "double-check the schema" },
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("transitions directly to AwaitingPlanApproval when the reviewer approves without revision", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED

    const result = await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("delegates to runPlanRevision when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "needs fixes",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "x", details: "y" }],
    });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision })); // PLAN_REVIEW_CHANGES_REQUESTED

    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
    expect(result.planVersion).toBe(2);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const { deps, runRepo, linearClient, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.ReadyForHumanReview });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("continues to Done even when the distillation agent throws (best-effort)", async () => {
    const { deps, runRepo, logger, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.ReadyForHumanReview });

    runRepo.findById.mockResolvedValue(run);
    distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("works when no distillationAgent was injected at all", async () => {
    const { deps, runRepo } = buildDeps();
    const depsWithoutDistillation = { ...deps, distillationAgent: undefined };
    const svc = new OrchestratorService(depsWithoutDistillation as never);
    const run = makeRun({ state: RunState.ReadyForHumanReview });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});

describe("OrchestratorService.buildTaskBundle (via runPlanRevision)", () => {
  it("prefers the remote default branch over the configured one when they differ, and logs a warning", async () => {
    const { deps, runRepo, artifactRepo, githubClient, logger, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.PlanRevision });
    const plan = makePlan();
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "x",
      findings: [],
      overallVerdict: "changes_requested",
    };

    githubClient.getDefaultBranch.mockResolvedValue("develop");
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview") return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanRevision("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    const bundleArg = planReviserAgent.run.mock.calls[0][2] as { repo: { defaultBranch: string } };
    expect(bundleArg.repo.defaultBranch).toBe("develop");
  });
});
