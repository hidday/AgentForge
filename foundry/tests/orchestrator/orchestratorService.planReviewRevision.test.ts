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
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: ["Some risk"],
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
    linearClient,
    planReviewerAgent,
    planReviserAgent,
  };
}

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("changes_requested verdict: posts findings comment and chains into runPlanRevision", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviewerAgent, planReviserAgent } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Needs work",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "risk",
          affectedStepId: "s1",
          title: "Missing rollback plan",
          details: "Add a rollback step",
        },
      ],
    };
    const revisedPlan = makePlan({ planVersion: 2 });

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 1 }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview") {
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      }
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue(planReview);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision })) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 })); // PLAN_REVISED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Good catch" }],
      },
      revisedPlan,
    });

    const result = await svc.runPlanReview("run-1");

    expect(planReviserAgent.run).toHaveBeenCalled();
    const commentCalls = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls;
    const findingsComment = commentCalls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Changes Requested"),
    );
    expect(findingsComment).toBeDefined();
    expect(findingsComment![1]).toContain("Missing rollback plan");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("approved verdict: transitions to AwaitingPlanApproval and posts an approval comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Looks good",
      overallVerdict: "approved",
      findings: [],
    });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const commentCalls = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls;
    const approvalComment = commentCalls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("approved"),
    );
    expect(approvalComment).toBeDefined();
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, persists the new version, and posts plan + disposition comments", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Needs work",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "risk",
          title: "Data loss risk",
          details: "Back up before migrating",
        },
      ],
    };
    const revisedPlan = makePlan({ planVersion: 2, summary: "Revised plan" });

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 1 }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview") {
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      }
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Will add backup step" }],
      },
      revisedPlan,
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const result = await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", undefined);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    const comments = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls;
    expect(comments[0][1]).toContain("Revised plan");
    expect(comments[0][1]).toContain("Plan Revision Dispositions");
    expect(comments[0][1]).toContain("Will add backup step");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("forwards an operator note as operatorNote when opts.note is provided", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "s",
      overallVerdict: "changes_requested",
      findings: [],
    };
    const revisedPlan = makePlan({ planVersion: 2 });

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "PlanReview") {
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReview }));
      }
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan,
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanRevision("run-1", { note: "Please keep it minimal" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "Please keep it minimal" },
    );
  });
});
