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

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
}): Artifact {
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
  // Simulates the real PlanReviewerAgent, which persists its PlanReview
  // artifact itself before returning.
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
          dispositions: [
            { findingId: "f1", status: "accepted", rationale: "Valid finding, addressed" },
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

describe("OrchestratorService.approvePlan", () => {
  it("throws when there is no Plan artifact", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("sets approvedPlanVersion, transitions to Implementing, and posts a plain approval comment (no note)", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 3, payloadJson: makePlan({ planVersion: 3 }) })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan("run-1");

    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(result.state).toBe(RunState.Implementing);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v3 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const store: TestStore = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1", { note: "Please use library X" });

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Please use library X"),
    );
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("with operator note"),
    );
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when there is no Plan artifact", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.PlanReview }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict: transitions to AwaitingPlanApproval and posts an 'approved' plan comment", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.PlanReview }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.setVerdict(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("approved"),
    );
  });

  it("changes_requested verdict: transitions through PlanRevision and delegates to runPlanRevision", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.PlanReview }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.setVerdict(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "pf1", severity: "important", type: "gap", title: "Missing step", details: "explain more" },
        ],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanReview("run-1");

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVISED);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    // runPlanRevision always lands back on AwaitingPlanApproval
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("calls planReviserAgent without an operatorNote option when no note is given", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.PlanRevision }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: makePlanReview({ overallVerdict: "changes_requested" }) }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.runPlanRevision("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.objectContaining({ overallVerdict: "changes_requested" }),
      expect.anything(),
      "run-1",
      undefined,
    );
  });

  it("passes operatorNote through to planReviserAgent when a note is given", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.PlanRevision }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: makePlanReview({ overallVerdict: "changes_requested" }) }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.runPlanRevision("run-1", { note: "keep it minimal" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "keep it minimal" },
    );
  });

  it("updates planVersion, transitions to AwaitingPlanApproval, and posts a combined plan+disposition comment", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.PlanRevision, planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({ type: "PlanReview", version: 1, payloadJson: makePlanReview({ overallVerdict: "changes_requested" }) }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanRevision("run-1");

    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan Revision Dispositions"),
    );
  });
});
