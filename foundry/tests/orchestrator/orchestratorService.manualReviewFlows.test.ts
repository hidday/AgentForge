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

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
}): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

interface TestStore {
  runState: RunState;
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...store.run, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      store.run = { ...store.run, state: newState };
      return Promise.resolve(store.run);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve(store.run);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
        const a = asArtifact({
          type: params.type,
          version: params.version,
          payloadJson: params.payloadJson,
        });
        store.artifacts.push(a);
        return Promise.resolve(a);
      },
    ),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
        const e: RunEventRecord = {
          id: `event-${store.events.length}`,
          runId: params.runId,
          eventType: params.eventType,
          source: params.source,
          payloadJson: params.payloadJson ?? {},
          createdAt: new Date(),
        };
        store.events.push(e);
        return Promise.resolve(e);
      },
    ),
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
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
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
    planReviewerAgent,
    planReviserAgent,
    linearClient,
    logger,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: transitions to AwaitingPlanApproval via PLAN_REVIEW_APPROVED", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "All good",
      overallVerdict: "approved",
      findings: [],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(store.events.map((e) => e.eventType)).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into PlanRevision)", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Needs work",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "gap", title: "Gap", details: "Missing step" },
      ],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(store.events.map((e) => e.eventType)).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("passes opts.note through to the plan reviewer agent and the RE_REVIEW_REQUESTED event payload", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      overallVerdict: "approved",
      findings: [],
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runManualReReview("run-1", { note: "Double check auth" });

    const call = built.planReviewerAgent.run.mock.calls[0];
    expect(call[3]).toEqual({ operatorNote: "Double check auth" });

    const reReviewEvent = store.events.find(
      (e) => e.eventType === (RunEvent.RE_REVIEW_REQUESTED as string),
    );
    expect((reReviewEvent!.payloadJson as { note?: string }).note).toBe("Double check auth");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: transitions to AwaitingPlanApproval without invoking the plan reviser", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "All good",
      overallVerdict: "approved",
      findings: [],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(built.planReviserAgent.run).not.toHaveBeenCalled();
    expect(store.events.map((e) => e.eventType)).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_APPROVED,
    ]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: transitions through PlanRevision and delegates to runPlanRevision with the note", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Needs work",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "gap", title: "Gap", details: "Missing step" },
      ],
    });
    built.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "Fixed" }] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "Tighten scope" });

    expect(store.events.map((e) => e.eventType)).toEqual([
      RunEvent.RE_REVIEW_REQUESTED,
      RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
      RunEvent.PLAN_REVISED,
    ]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.run.planVersion).toBe(3);

    const revisionCall = built.planReviserAgent.run.mock.calls[0];
    expect(revisionCall[4]).toEqual({ operatorNote: "Tighten scope" });
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});
