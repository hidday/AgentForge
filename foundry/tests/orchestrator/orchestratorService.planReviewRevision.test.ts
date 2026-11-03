import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
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
    branchName: "ai/run-1",
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
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: ["risk one"],
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
  };
}

describe("OrchestratorService.runPlanReview", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runPlanReview("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("approved verdict: transitions to AwaitingPlanApproval and posts the approved plan comment", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(planReviewRun);
    runRepo.updateState.mockResolvedValue(awaitingApprovalRun);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Solid plan",
      findings: [],
    });

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI plan review: approved"),
    );
  });

  it("changes_requested verdict: posts the review comment and chains into runPlanRevision", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const planRevisionRun = makeRun({ state: RunState.PlanRevision });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    runRepo.findById.mockResolvedValueOnce(planReviewRun).mockResolvedValue(planRevisionRun);
    runRepo.updateState
      .mockResolvedValueOnce(planRevisionRun) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVISED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview") {
        return Promise.resolve(
          makeArtifact({
            type: "PlanReview",
            payloadJson: {
              reviewId: "rev-1",
              overallVerdict: "changes_requested",
              summary: "Needs fixes",
              findings: [{ id: "f1", severity: "important", type: "gap", title: "Missing step", details: "detail" }],
            },
          }),
        );
      }
      return Promise.resolve(null);
    });

    const planReview: PlanReview = {
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "Needs fixes",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Missing step", details: "detail" }],
    };
    planReviewerAgent.run.mockResolvedValue(planReview);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "Fixed it" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI Plan Review -- Changes Requested"),
    );
    expect(planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps the run's planVersion, and posts the combined comment", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planRevisionRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    runRepo.findById.mockResolvedValue(planRevisionRun);
    runRepo.updateState.mockResolvedValue(awaitingApprovalRun);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));

    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = {
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "Needs fixes",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Missing step", details: "detail" }],
    };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview") return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      return Promise.resolve(null);
    });

    const revisedPlan = makePlan({ planVersion: 2, summary: "Revised summary" });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "Addressed" }] },
      revisedPlan,
    });

    const result = await svc.runPlanRevision("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", undefined);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(comment).toContain("Revised after AI review");
    expect(comment).toContain("Plan Revision Dispositions");
    expect(comment).toContain("Addressed");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes an operatorNote through to the planReviserAgent when opts.note is provided", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const planRevisionRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    runRepo.findById.mockResolvedValue(planRevisionRun);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });

    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanRevision("run-1", { note: "please double check auth" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      undefined,
      expect.anything(),
      "run-1",
      { operatorNote: "please double check auth" },
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.approvePlan("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("sets approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    runRepo.findById.mockResolvedValue(awaitingRun);
    const withApproval = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2, approvedPlanVersion: 2 });
    runRepo.update.mockResolvedValue(withApproval);
    const implementingRun = makeRun({ state: RunState.Implementing, planVersion: 2, approvedPlanVersion: 2 });
    runRepo.updateState.mockResolvedValue(implementingRun);

    const plan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v2 approved. Starting implementation...",
    );
    expect(result.state).toBe(RunState.Implementing);
  });

  it("includes the operator note in both the transition payload and the Linear comment when opts.note is set", async () => {
    const { deps, runRepo, artifactRepo, linearClient, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const awaitingRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    runRepo.findById.mockResolvedValue(awaitingRun);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1, approvedPlanVersion: 1 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing, planVersion: 1, approvedPlanVersion: 1 }));

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan }));

    await svc.approvePlan("run-1", { note: "Prioritize security" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Prioritize security"),
    );
    const eventCall = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "PLAN_APPROVED",
    );
    expect(eventCall?.[0]).toMatchObject({ payloadJson: expect.objectContaining({ note: "Prioritize security" }) });
  });
});
