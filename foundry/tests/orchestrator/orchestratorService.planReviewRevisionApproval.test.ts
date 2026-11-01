import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
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
    workingDirectory: "/work",
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

function makeBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "title", description: "desc", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/work",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
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
  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "title",
      description: "desc",
      branchName: "ai/run-1",
      state: "PlanReview",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/work"),
  };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
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
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return {
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
  };
}

function spyBuildTaskBundle(svc: OrchestratorService) {
  return vi
    .spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle")
    .mockResolvedValue(makeBundle());
}

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("on approved verdict: transitions to AwaitingPlanApproval and posts an approval comment", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.PlanReview });
    deps.runRepo.findById.mockResolvedValue(run);
    const plan = makePlan();
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: plan }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "Looks good",
      findings: [],
      overallVerdict: "approved",
    } as PlanReview);
    deps.runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("approved"),
    );
  });

  it("on changes_requested verdict: transitions to PlanRevision, posts findings, and delegates to runPlanRevision", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.PlanReview });
    deps.runRepo.findById.mockResolvedValue(run);
    const plan = makePlan();
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: plan }) : Promise.resolve(null),
    );
    const planReview: PlanReview = {
      reviewId: "rev-1",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "blocker", title: "Missing error handling", details: "Add try/catch" }],
      overallVerdict: "changes_requested",
    };
    deps.planReviewerAgent.run.mockResolvedValue(planReview);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runPlanReview("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Missing error handling"),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps planVersion, transitions to AwaitingPlanApproval, and posts a combined comment", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    deps.runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = {
      reviewId: "rev-1",
      summary: "Needs work",
      findings: [],
      overallVerdict: "changes_requested",
    };
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: plan });
      if (type === "PlanReview") return Promise.resolve({ payloadJson: planReview });
      return Promise.resolve(null);
    });
    const revisedPlan = makePlan({ planVersion: 2 });
    deps.planReviserAgent.run.mockResolvedValue({
      revision: { originalPlanVersion: 1, revisedPlanVersion: 2, dispositions: [] },
      revisedPlan,
    });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);

    const result = await svc.runPlanRevision("run-1");

    expect(deps.runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(deps.linearClient.postComment).toHaveBeenCalledTimes(1);
  });

  it("passes an operatorNote through to the plan reviser agent when opts.note is set", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "PlanReview")
        return Promise.resolve({
          payloadJson: { reviewId: "rev-1", summary: "s", findings: [], overallVerdict: "changes_requested" },
        });
      return Promise.resolve(null);
    });
    deps.planReviserAgent.run.mockResolvedValue({
      revision: { originalPlanVersion: 1, revisedPlanVersion: 2, dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);

    await svc.runPlanRevision("run-1", { note: "Please keep it minimal" });

    const call = deps.planReviserAgent.run.mock.calls[0];
    expect(call[4]).toEqual({ operatorNote: "Please keep it minimal" });
  });

  it("passes undefined options to the plan reviser agent when no note is given", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "PlanReview")
        return Promise.resolve({
          payloadJson: { reviewId: "rev-1", summary: "s", findings: [], overallVerdict: "changes_requested" },
        });
      return Promise.resolve(null);
    });
    deps.planReviserAgent.run.mockResolvedValue({
      revision: { originalPlanVersion: 1, revisedPlanVersion: 2, dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    spyBuildTaskBundle(svc);

    await svc.runPlanRevision("run-1");

    const call = deps.planReviserAgent.run.mock.calls[0];
    expect(call[4]).toBeUndefined();
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts a plain approval comment with no note", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan({ planVersion: 3 });
    deps.artifactRepo.findLatestByType.mockResolvedValue({ payloadJson: plan });
    deps.runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 3 }),
    );
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approvePlan("run-1");

    expect(deps.runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(result.state).toBe(RunState.Implementing);
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v3 approved. Starting implementation...",
    );
  });

  it("includes the operator note (quoted) in the approval comment and in the recorded event payload when opts.note is set", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan({ planVersion: 4 });
    deps.artifactRepo.findLatestByType.mockResolvedValue({ payloadJson: plan });
    deps.runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 4 }),
    );
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 4 }));

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "Ship it fast" });

    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v4 approved with operator note. Starting implementation...\n\n> Ship it fast",
    );
    const eventCall = deps.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "PLAN_APPROVED",
    );
    expect(eventCall).toBeDefined();
    expect((eventCall![0] as { payloadJson: { note?: string } }).payloadJson.note).toBe("Ship it fast");
  });
});
