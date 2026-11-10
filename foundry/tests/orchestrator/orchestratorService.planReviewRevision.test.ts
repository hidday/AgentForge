import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.PlanReview,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 2,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Needs work",
    findings: [
      {
        id: "f1",
        severity: "important",
        type: "design",
        affectedStepId: "s1",
        title: "Missing error handling",
        details: "Step 1 doesn't handle failures",
      },
    ],
    overallVerdict: "changes_requested",
    ...overrides,
  };
}

function buildDeps(initialRun: Run, planArtifactPayload: Plan | null = makePlan()) {
  let currentRun = initialRun;
  const artifacts = new Map<string, unknown>();
  if (planArtifactPayload) artifacts.set("Plan", { payloadJson: planArtifactPayload });
  artifacts.set("PlanReview", { payloadJson: makePlanReview() });

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      currentRun = { ...currentRun, state: newState };
      return Promise.resolve(currentRun);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      currentRun = { ...currentRun, ...patch };
      return Promise.resolve(currentRun);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi
      .fn()
      .mockImplementation((_id: string, type: string) =>
        Promise.resolve(artifacts.get(type) ?? null),
      ),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Title",
      description: "desc",
      branchName: "ai/lin-1",
      state: "Todo",
      labels: [],
      priority: 0,
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
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Fixed in v3" }],
      },
      revisedPlan: makePlan({ planVersion: 3 }),
    }),
  };
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
    },
    artifactRepo,
    linearClient,
    planReviewerAgent,
    planReviserAgent,
    getCurrentRun: () => currentRun,
  };
}

describe("OrchestratorService.runPlanReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when no Plan artifact exists for the run", async () => {
    const built = buildDeps(makeRun(), null);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("changes_requested: transitions to PlanRevision, posts the plan-review comment, then delegates to runPlanRevision", async () => {
    const built = buildDeps(makeRun({ state: RunState.PlanReview }));
    const svc = new OrchestratorService(built.deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }) as Run);

    await svc.runPlanReview("run-1");

    expect(built.getCurrentRun().state).toBe(RunState.PlanRevision);
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(comment).toContain("Changes Requested");
    expect(comment).toContain("Missing error handling");
  });

  it("approved: transitions to AwaitingPlanApproval and does NOT call runPlanRevision", async () => {
    const built = buildDeps(makeRun({ state: RunState.PlanReview }));
    built.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "approved", findings: [] }),
    );
    const svc = new OrchestratorService(built.deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revises the plan, updates planVersion, transitions to AwaitingPlanApproval, and posts a combined comment", async () => {
    const built = buildDeps(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.getCurrentRun().planVersion).toBe(3);
    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(comment).toContain("Revised after AI review");
    expect(comment).toContain("Plan Revision Dispositions");
    expect(comment).toContain("Fixed in v3");
  });

  it("passes opts.note through as operatorNote to the plan reviser agent", async () => {
    const built = buildDeps(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.runPlanRevision("run-1", { note: "Please simplify step 1" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "Please simplify step 1" },
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when no Plan artifact exists for the run", async () => {
    const built = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval }), null);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("records approvedPlanVersion, transitions to Implementing, and posts a plain approval comment when no note is given", async () => {
    const built = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(built.getCurrentRun().approvedPlanVersion).toBe(2);
    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(comment).toBe("Plan v2 approved. Starting implementation...");
  });

  it("includes the operator note in the approval comment when opts.note is given", async () => {
    const built = buildDeps(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1", { note: "Prioritize the API change" });

    const comment = (built.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("Prioritize the API change");
  });
});
