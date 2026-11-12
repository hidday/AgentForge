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

interface TestStore {
  runState: RunState;
}

function buildDeps(initialRun: Run, store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, state: store.runState }),
    ),
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
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    planReviewerAgent,
    planReviserAgent,
  };
}

describe("OrchestratorService.runPlanReview -- changes_requested branch", () => {
  it("transitions to PlanRevision and chains into runPlanRevision when the plan reviewer requests changes", async () => {
    const initialRun = makeRun({ state: RunState.PlanReview });
    const store: TestStore = { runState: RunState.PlanReview };
    const { deps, artifactRepo, linearClient, planReviewerAgent, planReviserAgent } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });

    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "gap",
          title: "Missing edge case",
          details: "Handle empty input",
        },
      ],
    });

    const result = await svc.runPlanReview("run-1");

    // PLAN_REVIEW_CHANGES_REQUESTED -> PlanRevision, then PLAN_REVISED -> AwaitingPlanApproval
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).toHaveBeenCalledTimes(1);

    const reviewComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Changes Requested"),
    );
    expect(reviewComment).toBeDefined();
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, records PLAN_REVISED, updates planVersion, and posts combined comment", async () => {
    const initialRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const store: TestStore = { runState: RunState.PlanRevision };
    const { deps, artifactRepo, linearClient, planReviserAgent, runRepo } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    const planReview = {
      reviewId: "pr-1",
      overallVerdict: "changes_requested" as const,
      summary: "Needs work",
      findings: [],
    };
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(asArtifact("PlanReview", 1, planReview));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "Valid point" },
        ],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", undefined);
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const combinedComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      typeof c[1] === "string" &&
      (c[1] as string).includes("Revised after AI review") &&
      (c[1] as string).includes("Plan Revision Dispositions"),
    );
    expect(combinedComment).toBeDefined();
  });

  it("forwards an operator note to the plan reviser agent", async () => {
    const initialRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const store: TestStore = { runState: RunState.PlanRevision };
    const { deps, artifactRepo, planReviserAgent } = buildDeps(initialRun, store);
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanRevision("run-1", { note: "please simplify step 1" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      undefined,
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify step 1" },
    );
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("always returns to AwaitingPlanApproval when the plan reviewer approves", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent, eventRepo } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.RE_REVIEW_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_APPROVED);
  });

  it("also returns to AwaitingPlanApproval (not PlanRevision) when the plan reviewer requests changes", async () => {
    // Per the implementation comment: manual re-review always hands control
    // back to the human, even on changes_requested, instead of auto-chaining
    // into PlanRevision the way the automated runPlanReview flow does.
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "nit", type: "style", title: "Nit", details: "d" }],
    });

    const result = await svc.runManualReReview("run-1", { note: "double check step 2" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", {
      operatorNote: "double check step 2",
    });
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("stays in AwaitingPlanApproval without revising when the reviewer approves", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("drives a full revision cycle (PlanRevision -> AwaitingPlanApproval) when the reviewer requests changes", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store: TestStore = { runState: RunState.AwaitingPlanApproval };
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent, runRepo } = buildDeps(
      initialRun,
      store,
    );
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? asArtifact("Plan", 1, plan) : null),
    );
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "d" }],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, undefined, expect.anything(), "run-1", {
      operatorNote: "tighten scope",
    });
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});
