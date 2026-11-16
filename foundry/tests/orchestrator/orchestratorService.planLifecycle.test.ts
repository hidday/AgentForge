import { describe, it, expect, vi, beforeEach } from "vitest";
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
    state: RunState.PlanReview,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
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
    update: vi.fn(),
    updateState: vi.fn(),
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
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
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
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
    postRemediationResolutions: vi.fn(),
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
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
    gitService,
    logger,
  };
}

describe("OrchestratorService.runPlanReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when no plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.runPlanReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("transitions to AwaitingPlanApproval and posts an approval comment when the plan is approved", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviewerAgent, eventRepo } =
      buildDeps();
    const run = makeRun({ state: RunState.PlanReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : null,
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI plan review: approved"),
    );
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_APPROVED);
  });

  it("transitions to PlanRevision, posts a changes-requested comment, and invokes runPlanRevision when changes are requested", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviewerAgent, planReviserAgent } =
      buildDeps();
    const run = makeRun({ state: RunState.PlanReview });
    runRepo.findById
      .mockResolvedValueOnce(run) // runPlanReview's requireRun
      .mockResolvedValue(makeRun({ state: RunState.PlanRevision })); // runPlanRevision's requireRun
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({ type: "PlanReview", payloadJson: makePlanReview() }),
        );
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "gap",
            title: "Missing step",
            details: "Need to handle X",
          },
        ],
      }),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "fair" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision })) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVISED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).toHaveBeenCalled();
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan Revision Dispositions"),
    );
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revises the plan, updates planVersion, transitions PLAN_REVISED, and posts a combined comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviserAgent } = buildDeps();
    const run = makeRun({ state: RunState.PlanRevision });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({ type: "PlanReview", payloadJson: makePlanReview() }),
        );
      return Promise.resolve(null);
    });
    const revisedPlan = makePlan({ planVersion: 3 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "rejected", rationale: "n/a" }] },
      revisedPlan,
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 3 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runPlanRevision("run-1", { note: "focus on security" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 3 });
    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "focus on security" },
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Revised after AI review"),
    );
  });

  it("passes undefined options to planReviserAgent.run when no operator note is given", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : null,
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      undefined, // no PlanReview artifact was mocked
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("stamps approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan"
        ? Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 2 }) }))
        : null,
    );
    runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 2 }),
    );
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    expect(result.state).toBe(RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v2 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment and in the transition event payload", async () => {
    const { deps, runRepo, artifactRepo, linearClient, eventRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan"
        ? Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 1 }) }))
        : null,
    );
    runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 }),
    );
    runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 }),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "please be careful with migrations" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("please be careful with migrations"),
    );
    const eventCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect(eventCall).toBeDefined();
    expect(
      (eventCall![0] as { payloadJson: { note?: string } }).payloadJson.note,
    ).toBe("please be careful with migrations");
  });
});

describe("OrchestratorService.runManualReReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("always returns to AwaitingPlanApproval when the reviewer approves", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : null,
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : null,
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "nit", type: "style", title: "nit", details: "minor" },
        ],
      }),
    );
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1", { note: "double check perf" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check perf" },
    );
  });

  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stays approved without revising when the reviewer approves", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : null,
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("invokes runPlanRevision (with operator note) when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })) // outer requireRun
      .mockResolvedValue(makeRun({ state: RunState.PlanRevision })); // inner runPlanRevision's requireRun
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ payloadJson: makePlan() })) : null,
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "x", details: "y" },
        ],
      }),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision })) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVISED

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      undefined, // no PlanReview artifact was mocked
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
  });
});
