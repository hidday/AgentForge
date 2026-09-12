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

function makeArtifact(overrides: Partial<Artifact> & { type: Artifact["type"] }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version ?? 1}`,
    runId: "run-1",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
}

function buildDeps(store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi
      .fn()
      .mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
        const a = makeArtifact({
          type: params.type as Artifact["type"],
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
      }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(
        matching.reduce((best, cur) => (cur.version > best.version ? cur : best)),
      );
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    planReviserAgent,
  };
}

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("changes_requested verdict posts the plan-review comment and chains into plan revision", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      run: makeRun({ state: RunState.PlanReview, planVersion: 1 }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    };
    const { deps, linearClient, eventRepo, planReviserAgent } = buildDeps(store);
    (deps.planReviewerAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs more detail",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "gap",
          affectedStepId: "s1",
          title: "Missing rollback plan",
          details: "Add a rollback step.",
        },
      ],
    });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "addressed", rationale: "Added rollback step" }],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanReview("run-1");

    // The plan-review comment (changes requested + finding) was posted.
    const reviewComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Changes Requested"),
    );
    expect(reviewComment).toBeDefined();
    expect(reviewComment![1]).toContain("Missing rollback plan");

    // The revision-disposition comment was also posted.
    const revisionComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Plan Revision Dispositions"),
    );
    expect(revisionComment).toBeDefined();
    expect(revisionComment![1]).toContain("Added rollback step");

    const eventTypes = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVISED);

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("approved verdict transitions straight to AwaitingPlanApproval and posts an approval comment", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      run: makeRun({ state: RunState.PlanReview, planVersion: 1 }),
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    };
    const { deps, linearClient, planReviserAgent } = buildDeps(store);
    (deps.planReviewerAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Looks solid",
      findings: [],
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanReview("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const approvalComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("approved"),
    );
    expect(approvalComment).toBeDefined();
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("forwards an operator note to the plan reviser agent", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      run: makeRun({ state: RunState.PlanRevision, planVersion: 1 }),
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        makeArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { reviewId: "pr-1", overallVerdict: "changes_requested", summary: "s", findings: [] },
        }),
      ],
    };
    const { deps, planReviserAgent } = buildDeps(store);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanRevision("run-1", { note: "please simplify step 1" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      expect.objectContaining({ overallVerdict: "changes_requested" }),
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify step 1" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});
