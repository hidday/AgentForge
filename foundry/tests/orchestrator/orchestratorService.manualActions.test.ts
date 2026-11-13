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

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
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

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
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
    update: vi.fn().mockImplementation((_id: string, params: Record<string, unknown>) => {
      Object.assign(initialRun, params);
      return Promise.resolve({ ...initialRun, ...params, state: store.runState });
    }),
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
      const revisedPlan = { ...plan, planVersion: plan.planVersion + 1 };
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
          dispositions: [],
        },
        revisedPlan,
      };
    }),
  };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
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
      distillationAgent,
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
    distillationAgent,
    logger,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("goes to AwaitingPlanApproval when the reviewer approves", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, initialRun);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Still good",
      findings: [],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1", { note: "double check auth" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check auth" },
    );

    const reReviewEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    );
    expect(reReviewEvent).toBeDefined();
    expect((reReviewEvent![0] as { payloadJson: { note?: string } }).payloadJson.note).toBe(
      "double check auth",
    );
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when the reviewer requests changes", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, initialRun);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "Needs tweaks",
      findings: [{ id: "f1", severity: "nit", type: "style", title: "naming", details: "rename" }],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("passes undefined options and 'trigger: re-review' only when no note is given", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, initialRun);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runManualReReview("run-1");

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
    const reReviewEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    );
    expect((reReviewEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
      trigger: "re-review",
    });
    expect(
      (reReviewEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson,
    ).not.toHaveProperty("note");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved: transitions to AwaitingPlanApproval without revising", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, initialRun);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "Fine as-is",
      findings: [],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("changes requested: revises the plan (with the operator note) and lands in AwaitingPlanApproval", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: { summary: "x", findings: [] },
        }),
      ],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, initialRun);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "Needs rework",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "x", details: "y" }],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(store, initialRun);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(built.distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);

    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("**Done**"),
    );
    expect(comment).toBeDefined();
  });

  it("swallows distillation failures (best-effort) and still completes the run", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(store, initialRun);
    built.distillationAgent.run.mockRejectedValue(new Error("distillation boom"));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const warnCall = built.logger.warn.mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("distillation boom");
  });

  it("works fine when no distillationAgent is configured", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildDeps(store, initialRun, { distillationAgent: undefined });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
