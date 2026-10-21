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
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
      project: "test-project",
      url: "https://linear.app/x/LIN-1",
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
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
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
  };
}

describe("OrchestratorService.approvePlan", () => {
  it("throws when no plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("records the approved plan version, transitions state, and posts a plain comment with no operator note", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan({ planVersion: 2 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ payloadJson: plan, version: 2 }));
    runRepo.update.mockResolvedValue({ ...run, approvedPlanVersion: 2 });
    runRepo.updateState.mockResolvedValue({ ...run, approvedPlanVersion: 2, state: RunState.Implementing });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      "Plan v2 approved. Starting implementation...",
    );
    expect(result.state).toBe(RunState.Implementing);
  });

  it("includes the operator note in the approval comment and event payload when provided", async () => {
    const { deps, runRepo, artifactRepo, linearClient, eventRepo } = buildDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan({ planVersion: 3 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ payloadJson: plan, version: 3 }));
    runRepo.update.mockResolvedValue({ ...run, approvedPlanVersion: 3 });
    runRepo.updateState.mockResolvedValue({ ...run, approvedPlanVersion: 3, state: RunState.Implementing });
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1", { note: "please keep it minimal" });

    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("please keep it minimal"),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({ note: "please keep it minimal" }),
      }),
    );
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("transitions to AwaitingPlanApproval and posts an approval comment when the review verdict is approved", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const run = makeRun({ state: RunState.PlanReview });
    const plan = makePlan();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ payloadJson: plan }));
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    } satisfies PlanReview);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.AwaitingPlanApproval });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanReview("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("approved"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("transitions to PlanRevision and delegates to runPlanRevision when changes are requested", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const run = makeRun({ state: RunState.PlanReview });
    const plan = makePlan();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ payloadJson: plan }));
    const review: PlanReview = {
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "major", title: "Issue", details: "details" }],
    };
    planReviewerAgent.run.mockResolvedValue(review);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.PlanRevision });
    const svc = new OrchestratorService(deps as never);
    const revisedRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisedRun);

    const result = await svc.runPlanReview("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.PlanRevision);
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(revisedRun);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("persists the revised plan version, transitions state, and posts combined plan + disposition comments", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent, linearClient } = buildDeps();
    const run = makeRun({ state: RunState.PlanRevision });
    const plan = makePlan({ planVersion: 2 });
    const planReview: PlanReview = {
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [],
    };
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: plan, version: 2 }));
      if (type === "PlanReview") return Promise.resolve(makeArtifact({ payloadJson: planReview, type: "PlanReview" }));
      return Promise.resolve(null);
    });
    const revisedPlan = makePlan({ planVersion: 3 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan,
    });
    runRepo.update.mockResolvedValue({ ...run, planVersion: 3 });
    runRepo.updateState.mockResolvedValue({ ...run, planVersion: 3, state: RunState.AwaitingPlanApproval });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanRevision("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 3 });
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledTimes(1);
    expect(result.planVersion).toBe(3);
  });

  it("passes the operator note through to the plan reviser agent when provided", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const run = makeRun({ state: RunState.PlanRevision });
    const plan = makePlan({ planVersion: 2 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: plan, version: 2 }));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1", { note: "focus on tests" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      undefined,
      expect.anything(),
      "run-1",
      { operatorNote: "focus on tests" },
    );
  });

  it("omits the options argument to the plan reviser agent when no note is given", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const run = makeRun({ state: RunState.PlanRevision });
    const plan = makePlan({ planVersion: 2 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: plan, version: 2 }));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });
    runRepo.update.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(run);
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      undefined,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});
