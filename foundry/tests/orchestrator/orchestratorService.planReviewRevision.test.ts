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
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

interface TestStore {
  runState: RunState;
  artifacts: Artifact[];
}

function asArtifact(params: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${params.type}-${params.version}`,
    runId: "run-1",
    type: params.type as Artifact["type"],
    version: params.version,
    payloadJson: params.payloadJson,
    rawText: JSON.stringify(params.payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps(store: TestStore, initialRun: Run) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ ...initialRun, id, state: store.runState })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, params: Record<string, unknown>) =>
      Promise.resolve({ ...initialRun, ...params, state: store.runState }),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact(params);
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
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
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoEntry = {
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
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
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
    run: vi.fn().mockImplementation(async (plan: Plan) => {
      const revisedPlan = makePlan({ planVersion: plan.planVersion + 1 });
      await artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: revisedPlan.planVersion,
        payloadJson: revisedPlan,
        rawText: "{}",
      });
      return {
        revision: {
          originalPlanVersion: plan.planVersion,
          revisedPlanVersion: revisedPlan.planVersion,
          reviewId: "rev-1",
          dispositions: [
            { findingId: "f1", status: "accepted" as const, rationale: "Fair point" },
          ],
        },
        revisedPlan,
      };
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

describe("OrchestratorService.runPlanReview", () => {
  it("approves and transitions to AwaitingPlanApproval, posting the approved-plan comment", async () => {
    const store: TestStore = {
      runState: RunState.PlanReview,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.PlanReview });
    const built = buildDeps(store, initialRun);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("approved"),
    );
    expect(comment).toBeDefined();
  });

  it("throws when there is no Plan artifact for the run", async () => {
    const store: TestStore = { runState: RunState.PlanReview, artifacts: [] };
    const initialRun = makeRun({ state: RunState.PlanReview });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("requests changes: posts the plan review comment with findings and chains into runPlanRevision", async () => {
    const store: TestStore = {
      runState: RunState.PlanReview,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.PlanReview });
    const built = buildDeps(store, initialRun);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "Needs more detail",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "gap",
          title: "Missing error handling",
          details: "Add retries",
          affectedStepId: "s1",
        },
      ],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanReview("run-1");

    // Plan review comment (changes requested) was posted
    const reviewComment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Changes Requested"),
    );
    expect(reviewComment).toBeDefined();
    expect(reviewComment![1]).toContain("Missing error handling");
    expect(reviewComment![1]).toContain("(step s1)");

    // Chained into runPlanRevision -> plan revised, back to AwaitingPlanApproval
    expect(built.planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVISED);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("passes opts.note through as operatorNote to the plan reviser", async () => {
    const store: TestStore = {
      runState: RunState.PlanRevision,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { reviewId: "rev-1", summary: "x", findings: [], overallVerdict: "changes_requested" },
        }),
      ],
    };
    const initialRun = makeRun({ state: RunState.PlanRevision });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanRevision("run-1", { note: "please simplify step 1" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify step 1" },
    );
  });

  it("passes undefined options when no note is given", async () => {
    const store: TestStore = {
      runState: RunState.PlanRevision,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { reviewId: "rev-1", summary: "x", findings: [], overallVerdict: "changes_requested" },
        }),
      ],
    };
    const initialRun = makeRun({ state: RunState.PlanRevision });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanRevision("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const revisionComment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Plan Revision Dispositions"),
    );
    expect(revisionComment).toBeDefined();
    expect(revisionComment![1]).toContain("Fair point");
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when there is no Plan artifact", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [] };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approves without a note: sets approvedPlanVersion and posts the plain approval comment", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 3, payloadJson: makePlan({ planVersion: 3 }) })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approvePlan("run-1");

    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(result.state).toBe(RunState.Implementing);

    const comment = built.linearClient.postComment.mock.calls[0];
    expect(comment[1]).toBe("Plan v3 approved. Starting implementation...");
  });

  it("approves with an operator note: includes it in the comment and in the transition payload", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    await svc.approvePlan("run-1", { note: "skip the migration step" });

    const comment = built.linearClient.postComment.mock.calls[0];
    expect(comment[1]).toContain("approved with operator note");
    expect(comment[1]).toContain("skip the migration step");

    const approvalEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect(approvalEvent).toBeDefined();
    expect((approvalEvent![0] as { payloadJson: { note?: string } }).payloadJson.note).toBe(
      "skip the migration step",
    );
  });
});
