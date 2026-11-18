import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
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

function asArtifact(o: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${o.type}-${o.version}-${Math.random().toString(36).slice(2, 7)}`,
    runId: "run-1",
    type: o.type as Artifact["type"],
    version: o.version,
    payloadJson: o.payloadJson,
    rawText: JSON.stringify(o.payloadJson),
    createdAt: new Date(),
  };
}

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
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
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `evt-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
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

describe("OrchestratorService.runManualReReview", () => {
  it("throws when the run does not exist", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store);
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("missing")).rejects.toThrow(/Run not found/);
  });

  it("throws when no Plan artifact exists", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict: records RE_REVIEW_REQUESTED then PLAN_REVIEW_APPROVED, landing back in AwaitingPlanApproval", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run: makeRun(), artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })], events: [] };
    const { deps, planReviewerAgent, eventRepo } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Still good",
      findings: [],
      overallVerdict: "approved",
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1");

    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into PlanRevision)", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run: makeRun(), artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })], events: [] };
    const { deps, planReviewerAgent, eventRepo, planReviserAgent } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
      overallVerdict: "changes_requested",
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes the operator note to both the RE_REVIEW_REQUESTED event payload and the plan reviewer agent", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run: makeRun(), artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })], events: [] };
    const { deps, planReviewerAgent, eventRepo } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runManualReReview("run-1", { note: "double check auth" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      { operatorNote: "double check auth" },
    );
    const reReviewEvent = eventRepo.create.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    );
    expect((reReviewEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
      trigger: "re-review",
      note: "double check auth",
    });
  });

  it("omits the note field from the event payload and reviewer options when no note is given", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run: makeRun(), artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })], events: [] };
    const { deps, planReviewerAgent, eventRepo } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runManualReReview("run-1");

    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", undefined);
    const reReviewEvent = eventRepo.create.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    );
    expect((reReviewEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson).not.toHaveProperty(
      "note",
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("throws when the run does not exist", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store);
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("missing")).rejects.toThrow(/Run not found/);
  });

  it("throws when no Plan artifact exists", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict: transitions to AwaitingPlanApproval without revising", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: Store = { run: makeRun(), artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })], events: [] };
    const { deps, planReviewerAgent, planReviserAgent, eventRepo } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Still good",
      findings: [],
      overallVerdict: "approved",
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: delegates to runPlanRevision and ends in AwaitingPlanApproval with the revised plan version", async () => {
    const plan = makePlan({ planVersion: 1 });
    const planReviewPayload = {
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
      overallVerdict: "changes_requested" as const,
    };
    const store: Store = { run: makeRun(), artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })], events: [] };
    const { deps, planReviewerAgent, planReviserAgent, eventRepo } = buildDeps(store);
    planReviewerAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "PlanReview", version: 1, payloadJson: planReviewPayload }));
      return Promise.resolve(planReviewPayload);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "will fix" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReviewPayload,
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
      RunEvent.PLAN_REVISED,
    ]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(result.planVersion).toBe(2);
  });

  it("changes_requested verdict without an operator note: calls runPlanRevision with no note options", async () => {
    const plan = makePlan({ planVersion: 1 });
    const planReviewPayload = {
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
      overallVerdict: "changes_requested" as const,
    };
    const store: Store = { run: makeRun(), artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })], events: [] };
    const { deps, planReviewerAgent, planReviserAgent } = buildDeps(store);
    planReviewerAgent.run.mockImplementation(() => {
      store.artifacts.push(asArtifact({ type: "PlanReview", version: 1, payloadJson: planReviewPayload }));
      return Promise.resolve(planReviewPayload);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    const svc = new OrchestratorService(deps as never);

    await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReviewPayload,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});
