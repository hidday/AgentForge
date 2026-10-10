import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { PlanRevision } from "../../src/schemas/planRevision.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
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
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp",
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

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
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
    getRepoByName: vi.fn().mockReturnValue(null),
    getDefaultRepo: vi.fn().mockReturnValue({
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
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
    postExecutionReportUpdate: vi.fn(),
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
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    dashboardEmitter,
    logger,
  };
}

describe("OrchestratorService.runPlanReview", () => {
  it("approves: transitions to AwaitingPlanApproval and posts the formatted plan comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    } as PlanReview);

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(comment).toContain("AI plan review: approved");
  });

  it("changes_requested: posts the plan-review comment with findings and chains into runPlanRevision", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "gap",
          affectedStepId: "s1",
          title: "Missing error handling",
          details: "Add a try/catch",
        },
      ],
      overallVerdict: "changes_requested",
    };

    const planReviewStateRun = makeRun({ state: RunState.PlanReview });
    const planRevisionStateRun = makeRun({ state: RunState.PlanRevision });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });

    runRepo.findById.mockResolvedValue(planReviewStateRun);
    runRepo.update.mockResolvedValue(planRevisionStateRun);
    runRepo.updateState
      .mockResolvedValueOnce(planRevisionStateRun) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVISED

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(asArtifact("PlanReview", 1, planReview));
      return Promise.resolve(null);
    });

    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(planReview);

    const revisedPlan = makePlan({ planVersion: 2 });
    const revision: PlanRevision = {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "pr-1",
      dispositions: [{ findingId: "f1", status: "accepted", rationale: "Valid gap, fixed" }],
    };
    planReviserAgent.run.mockResolvedValue({ revision, revisedPlan });

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const changesComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Changes Requested"),
    );
    expect(changesComment).toBeDefined();
    expect(changesComment![1]).toContain("Missing error handling");

    const revisionComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Plan Revision Dispositions"),
    );
    expect(revisionComment).toBeDefined();
    expect(revisionComment![1]).toContain("Valid gap, fixed");
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan with an operator note, updates planVersion, transitions to AwaitingPlanApproval", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "nit", type: "style", title: "Nit", details: "minor" }],
      overallVerdict: "changes_requested",
    };

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(asArtifact("PlanReview", 1, planReview));
      return Promise.resolve(null);
    });

    const revisedPlan = makePlan({ planVersion: 2 });
    const revision: PlanRevision = {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "pr-1",
      dispositions: [{ findingId: "f1", status: "dismissed", rationale: "Not worth it" }],
    };
    planReviserAgent.run.mockResolvedValue({ revision, revisedPlan });

    const result = await svc.runPlanRevision("run-1", { note: "please keep it minimal" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "please keep it minimal" },
    );
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(comment).toContain("Revised after AI review");
    expect(comment).toContain("Plan Revision Dispositions");
  });

  it("revises the plan without an operator note (opts omitted)", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [],
      overallVerdict: "changes_requested",
    };
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(asArtifact("PlanReview", 1, planReview));
      return Promise.resolve(null);
    });
    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: { originalPlanVersion: 1, revisedPlanVersion: 2, reviewId: "pr-1", dispositions: [] },
      revisedPlan,
    });

    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", undefined);
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("records approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 2 });
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(asArtifact("Plan", 2, plan));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }));

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    expect(result.state).toBe(RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v2 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment and the transition payload", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 3 });
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(asArtifact("Plan", 3, plan));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 3 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 }));

    await svc.approvePlan("run-1", { note: "skip the migration for now" });

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("skip the migration for now");

    const transitionEventPayload = (deps.eventRepo as { create: ReturnType<typeof vi.fn> }).create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "PLAN_APPROVED",
    )?.[0] as { payloadJson: Record<string, unknown> };
    expect(transitionEventPayload.payloadJson.note).toBe("skip the migration for now");
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: returns to AwaitingPlanApproval via PLAN_REVIEW_APPROVED", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    const result = await svc.runManualReReview("run-1", { note: "double-check security" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { operatorNote: "double-check security" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into revision)", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "t", details: "d" }],
    });

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: transitions to AwaitingPlanApproval without invoking the reviser", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: chains into runPlanRevision with the operator note", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan();
    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "t", details: "d" }],
      overallVerdict: "changes_requested",
    };

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision })) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 })); // PLAN_REVISED (inside runPlanRevision)
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(asArtifact("PlanReview", 1, planReview));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue(planReview);

    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: { originalPlanVersion: 1, revisedPlanVersion: 2, reviewId: "pr-1", dispositions: [] },
      revisedPlan,
    });

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});
