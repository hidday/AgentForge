import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { PlanRevision } from "../../src/schemas/planRevision.js";

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
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "prev-1",
    summary: "Reviewed the plan",
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

function buildDeps(overrides: {
  run?: Run;
  plan?: Plan;
  planReview?: PlanReview | null;
} = {}) {
  const run = overrides.run ?? makeRun();
  const plan = overrides.plan ?? makePlan();
  const planArtifact = makeArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan });
  const planReview = overrides.planReview === undefined ? makePlanReview() : overrides.planReview;
  const planReviewArtifact = planReview
    ? makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReview })
    : null;

  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) =>
      Promise.resolve({ ...run, state }),
    ),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) =>
      Promise.resolve({ ...run, ...patch }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      if (type === "PlanReview") return Promise.resolve(planReviewArtifact);
      return Promise.resolve(null);
    }),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/run-1",
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
    postExecutionReportUpdate: vi.fn(),
  };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(planReview ?? makePlanReview()) };
  const revisedPlan = makePlan({ planVersion: plan.planVersion + 1 });
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: {
        originalPlanVersion: plan.planVersion,
        revisedPlanVersion: revisedPlan.planVersion,
        reviewId: "prev-1",
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "Makes sense" },
        ],
      } as PlanRevision,
      revisedPlan,
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
    },
    run,
    plan,
    runRepo,
    artifactRepo,
    linearClient,
    planReviewerAgent,
    planReviserAgent,
  };
}

describe("OrchestratorService.approvePlan", () => {
  it("throws when there is no plan artifact", async () => {
    const { deps } = buildDeps();
    (deps.artifactRepo.findLatestByType as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("stamps approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const { deps, runRepo, linearClient } = buildDeps({
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 1 });
    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v1 approved. Starting implementation...",
    );
    expect(result).toBeDefined();
  });

  it("includes the operator note in the approval comment and event payload when provided", async () => {
    const { deps, linearClient, eventRepo } = buildDeps({
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
    }) as ReturnType<typeof buildDeps> & { eventRepo?: unknown };
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1", { note: "please prioritize security" });

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("please prioritize security");
    const eventCall = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect((eventCall![0] as { payloadJson: { note?: string } }).payloadJson.note).toBe(
      "please prioritize security",
    );
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when there is no plan artifact", async () => {
    const { deps } = buildDeps();
    (deps.artifactRepo.findLatestByType as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("approved: transitions to AwaitingPlanApproval and posts an approved plan comment", async () => {
    const { deps, runRepo, linearClient } = buildDeps({
      planReview: makePlanReview({ overallVerdict: "approved" }),
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanReview("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AwaitingPlanApproval);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(comment).toContain("approved");
  });

  it("changes_requested: transitions to PlanRevision, posts findings, and triggers revision", async () => {
    const { deps, runRepo, linearClient } = buildDeps({
      planReview: makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "risk",
            affectedStepId: "s1",
            title: "Missing rollback plan",
            details: "no rollback described",
          },
          {
            id: "f2",
            severity: "nit",
            type: "style",
            title: "Vague step title",
            details: "be more specific",
          },
        ],
      }),
    });
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(makeRun());

    await svc.runPlanReview("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.PlanRevision);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(comment).toContain("Changes Requested");
    expect(comment).toContain("(step s1)");
    expect(comment).toContain("Vague step title");
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, transitions to AwaitingPlanApproval, and posts plan + disposition comments", async () => {
    const { deps, runRepo, linearClient, planReviserAgent } = buildDeps({
      run: makeRun({ state: RunState.PlanRevision }),
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1");

    expect(runRepo.updateState).toHaveBeenCalledWith("run-1", RunState.AwaitingPlanApproval);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(comment).toContain("Revised after AI review");
    expect(comment).toContain("Plan Revision Dispositions");
    expect(comment).toContain("Makes sense");
    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
  });

  it("passes an operator note through to the plan reviser", async () => {
    const { deps, planReviserAgent } = buildDeps({ run: makeRun({ state: RunState.PlanRevision }) });
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanRevision("run-1", { note: "focus on security" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "focus on security" },
    );
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: records RE_REVIEW_REQUESTED then PLAN_REVIEW_APPROVED", async () => {
    const { deps, runRepo } = buildDeps({
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      planReview: makePlanReview({ overallVerdict: "approved" }),
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1");

    expect(runRepo.updateState).toHaveBeenNthCalledWith(1, "run-1", RunState.PlanReview);
    expect(runRepo.updateState).toHaveBeenNthCalledWith(2, "run-1", RunState.AwaitingPlanApproval);
    expect(result).toBeDefined();
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain revision)", async () => {
    const { deps, runRepo } = buildDeps({
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      planReview: makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "risk", title: "x", details: "y" },
        ],
      }),
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runManualReReview("run-1");

    expect(runRepo.updateState).toHaveBeenNthCalledWith(2, "run-1", RunState.AwaitingPlanApproval);
  });

  it("records the operator note on the RE_REVIEW_REQUESTED event when provided", async () => {
    const { deps } = buildDeps({ run: makeRun({ state: RunState.AwaitingPlanApproval }) });
    const svc = new OrchestratorService(deps as never);

    await svc.runManualReReview("run-1", { note: "double check auth" });

    const eventCall = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    );
    expect((eventCall![0] as { payloadJson: { note?: string; trigger: string } }).payloadJson).toEqual(
      expect.objectContaining({ trigger: "re-review", note: "double check auth" }),
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: transitions to AwaitingPlanApproval without triggering a revision", async () => {
    const { deps, runRepo } = buildDeps({
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      planReview: makePlanReview({ overallVerdict: "approved" }),
    });
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    await svc.runManualPlanRevision("run-1");

    expect(runRepo.updateState).toHaveBeenNthCalledWith(2, "run-1", RunState.AwaitingPlanApproval);
    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: transitions to PlanRevision and calls runPlanRevision with the note", async () => {
    const { deps, runRepo } = buildDeps({
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      planReview: makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "risk", title: "x", details: "y" }],
      }),
    });
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(makeRun());

    await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(runRepo.updateState).toHaveBeenNthCalledWith(2, "run-1", RunState.PlanRevision);
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
  });
});
