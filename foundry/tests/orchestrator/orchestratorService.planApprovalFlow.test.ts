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
    openQuestions: [
      { id: "q1", question: "Optional question?", requiredForExecution: false },
    ],
    risks: ["Some risk"],
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
    runRepo,
    artifactRepo,
    linearClient,
    planReviewerAgent,
    planReviserAgent,
    logger,
  };
}

describe("OrchestratorService.approvePlan", () => {
  it("sets approvedPlanVersion, transitions to Implementing, and posts a plain approval comment when no note is given", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan("run-1");

    expect(store.run.approvedPlanVersion).toBe(2);
    expect(result.state).toBe(RunState.Implementing);
    expect(store.events.map((e) => e.eventType)).toContain(RunEvent.PLAN_APPROVED);

    const comment = built.linearClient.postComment.mock.calls[0];
    expect(comment[1]).toBe("Plan v2 approved. Starting implementation...");
  });

  it("includes the operator note in the approval comment and event payload when provided", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1", { note: "Please prioritize security" });

    const comment = built.linearClient.postComment.mock.calls[0];
    expect(comment[1]).toContain("approved with operator note");
    expect(comment[1]).toContain("Please prioritize security");

    const approvalEvent = store.events.find((e) => e.eventType === (RunEvent.PLAN_APPROVED as string));
    expect((approvalEvent!.payloadJson as { note?: string }).note).toBe(
      "Please prioritize security",
    );
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

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runPlanReview -> runPlanRevision (changes_requested chain)", () => {
  it("posts the plan review comment, transitions through PlanRevision, revises the plan, and posts the revision comment", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.PlanReview,
      run: makeRun({ state: RunState.PlanReview, planVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);

    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Needs a fix",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "pf1",
          severity: "important",
          type: "gap",
          affectedStepId: "s1",
          title: "Missing edge case",
          details: "Step 1 doesn't handle nulls",
        },
      ],
    };
    built.planReviewerAgent.run.mockResolvedValue(planReview);

    const revisedPlan = makePlan({ planVersion: 3 });
    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [
          { findingId: "pf1", status: "addressed", rationale: "Added null check" },
        ],
      },
      revisedPlan,
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanReview("run-1");

    // formatPlanReviewComment output
    const reviewComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Plan Review"),
    );
    expect(reviewComment).toBeDefined();
    expect(reviewComment![1]).toContain("Changes Requested");
    expect(reviewComment![1]).toContain("Missing edge case");
    expect(reviewComment![1]).toContain("(step s1)");

    // formatPlanRevisionComment + formatPlanComment (revised) output
    const revisionComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Plan Revision Dispositions"),
    );
    expect(revisionComment).toBeDefined();
    expect(revisionComment![1]).toContain("pf1");
    expect(revisionComment![1]).toContain("Added null check");

    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([RunEvent.PLAN_REVIEW_CHANGES_REQUESTED, RunEvent.PLAN_REVISED]),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.run.planVersion).toBe(3);
  });

  it("passes opts.note through as an operatorNote to the plan reviser agent", async () => {
    const plan = makePlan({ planVersion: 2 });
    const store: TestStore = {
      runState: RunState.PlanRevision,
      run: makeRun({ state: RunState.PlanRevision, planVersion: 2 }),
      artifacts: [asArtifact({ type: "Plan", version: 2, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    built.planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 3 }),
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanRevision("run-1", { note: "Be more conservative" });

    expect(built.planReviserAgent.run).toHaveBeenCalledTimes(1);
    const call = built.planReviserAgent.run.mock.calls[0];
    expect(call[3]).toBe("run-1");
    expect(call[4]).toEqual({ operatorNote: "Be more conservative" });
  });

  it("throws when no Plan artifact exists for the run", async () => {
    const store: TestStore = {
      runState: RunState.PlanReview,
      run: makeRun({ state: RunState.PlanReview }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
