import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "prv-1",
    summary: "Reviewed",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
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
    create: vi.fn().mockImplementation((params: { runId: string; type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
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
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
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

  let currentPlanReview: PlanReview = makePlanReview();
  const planReviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      await artifactRepo.create({
        runId: store.run.id,
        type: "PlanReview",
        version: 1,
        payloadJson: currentPlanReview,
      });
      return currentPlanReview;
    }),
    setVerdict: (review: PlanReview) => {
      currentPlanReview = review;
    },
  };

  const planReviserAgent = {
    run: vi.fn().mockImplementation(async (plan: Plan) => {
      const revisedPlan = makePlan({ planVersion: plan.planVersion + 1 });
      return {
        revision: {
          originalPlanVersion: plan.planVersion,
          revisedPlanVersion: revisedPlan.planVersion,
          dispositions: [{ findingId: "f1", status: "accepted", rationale: "addressed" }],
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
    runRepo,
    artifactRepo,
    eventRepo,
    planReviewerAgent,
    planReviserAgent,
    linearClient,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("throws when there is no Plan artifact", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("records RE_REVIEW_REQUESTED with a 're-review' trigger tag and no note by default", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.runManualReReview("run-1");

    const reReviewEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    )?.[0] as { payloadJson: { trigger: string; note?: string } };
    expect(reReviewEvent.payloadJson.trigger).toBe("re-review");
    expect(reReviewEvent.payloadJson.note).toBeUndefined();
  });

  it("approved verdict: transitions back to AwaitingPlanApproval", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.setVerdict(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into revision)", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.setVerdict(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "explain" }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    // No plan revision should have run for the automatic manual re-review path.
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("passes the operator note through to planReviewerAgent and records it on the event", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.runManualReReview("run-1", { note: "double-check auth flow" });

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double-check auth flow" },
    );
    const reReviewEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    )?.[0] as { payloadJson: { note?: string } };
    expect(reReviewEvent.payloadJson.note).toBe("double-check auth flow");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("throws when there is no Plan artifact", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict: transitions to AwaitingPlanApproval without revising the plan", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.setVerdict(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: revises the plan and lands on AwaitingPlanApproval with an incremented planVersion", async () => {
    const store: TestStore = {
      run: makeRun({ planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.setVerdict(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "explain" }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runManualPlanRevision("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalledTimes(1);
    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVISED);
  });

  it("forwards the operator note to both planReviewerAgent and runPlanRevision", async () => {
    const store: TestStore = {
      run: makeRun({ planVersion: 1 }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.setVerdict(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "gap", title: "Gap", details: "explain" }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    await svc.runManualPlanRevision("run-1", { note: "prefer composition" });

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "prefer composition" },
    );
    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "prefer composition" },
    );
  });
});
