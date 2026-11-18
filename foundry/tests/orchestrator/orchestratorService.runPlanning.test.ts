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
    state: RunState.Planning,
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
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    }),
  };
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
    plannerAgent,
    planReviewerAgent,
    logger,
  };
}

/** Simulates the real PlannerAgent persisting a Plan artifact as a side effect. */
function plannerWritesPlan(
  store: Store,
  plannerAgent: { run: ReturnType<typeof vi.fn> },
  plan: (opts: Record<string, unknown> | undefined) => Plan,
) {
  plannerAgent.run.mockImplementation(
    (_bundle: unknown, _runId: string, opts?: Record<string, unknown>) => {
      const p = plan(opts);
      store.artifacts.push(asArtifact({ type: "Plan", version: p.planVersion, payloadJson: p }));
      return Promise.resolve(p);
    },
  );
}

describe("OrchestratorService.runPlanning", () => {
  it("throws when the run does not exist", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, runRepo } = buildDeps(store);
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanning("missing")).rejects.toThrow(/Run not found/);
  });

  it("re-plans with no prior context when no rejection/answers/review artifacts exist, then proceeds to plan review", async () => {
    const store: Store = { run: makeRun({ planVersion: 1 }), artifacts: [], events: [] };
    const { deps, plannerAgent, planReviewerAgent, eventRepo, linearClient } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 2, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({
        previousPlan: expect.anything(),
        humanFeedback: expect.anything(),
        humanAnswers: expect.anything(),
        researchedAnswers: expect.anything(),
        planReviewFindings: expect.anything(),
      }),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2 }),
    );
    // PLAN_CREATED then PLAN_REVIEW_APPROVED should both have been recorded.
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_APPROVED);
    expect(planReviewerAgent.run).toHaveBeenCalled();
    expect(linearClient.postComment).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("creates a TaskBundle artifact only if one doesn't already exist", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps, plannerAgent, artifactRepo } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, () => makePlan({ planVersion: 2, openQuestions: [] }));
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanning("run-1");

    const bundleCalls = artifactRepo.create.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === "TaskBundle",
    );
    expect(bundleCalls).toHaveLength(1);
  });

  it("injects humanFeedback from the latest RejectionContext artifact", async () => {
    const store: Store = { run: makeRun({ planVersion: 2 }), artifacts: [], events: [] };
    store.artifacts.push(
      asArtifact({
        type: "RejectionContext",
        version: 2,
        payloadJson: { planVersion: 2, feedback: "Use OAuth2", source: "api", mode: "iterate" },
      }),
    );
    const { deps, plannerAgent } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 3, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2" },
      }),
    );
  });

  it("injects the previous Plan, HumanAnswers, ResearchedAnswers and PlanReview findings when all artifacts exist", async () => {
    const store: Store = { run: makeRun({ planVersion: 2 }), artifacts: [], events: [] };
    const previousPlan = makePlan({ planVersion: 2, openQuestions: [] });
    store.artifacts.push(asArtifact({ type: "Plan", version: 2, payloadJson: previousPlan }));
    store.artifacts.push(
      asArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
      }),
    );
    store.artifacts.push(
      asArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: {
          summary: "ok",
          completedAt: new Date().toISOString(),
          answers: [{ questionId: "q2", question: "q2?", answer: "a2", confidence: "high" }],
        },
      }),
    );
    store.artifacts.push(
      asArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: {
          reviewId: "pr-1",
          summary: "Needs work",
          findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
          overallVerdict: "changes_requested",
        },
      }),
    );

    const { deps, plannerAgent } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 3, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan,
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "q2?", answer: "a2", confidence: "high" }],
        planReviewFindings: {
          summary: "Needs work",
          findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
        },
      }),
    );
  });

  it("pauses for human clarification when the re-plan still has blocking questions, without starting plan review", async () => {
    const store: Store = { run: makeRun({ planVersion: 1 }), artifacts: [], events: [] };
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({
        planVersion: (opts?.planVersionOverride as number) ?? 2,
        openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanning("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });

  it("does not block on open questions that are not required for execution", async () => {
    const store: Store = { run: makeRun({ planVersion: 1 }), artifacts: [], events: [] };
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({
        planVersion: (opts?.planVersionOverride as number) ?? 2,
        openQuestions: [{ id: "q1", question: "Nice to know?", requiredForExecution: false }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanning("run-1");

    expect(planReviewerAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("updates the run's planVersion and plannerRuntime from the newly created plan", async () => {
    const store: Store = { run: makeRun({ planVersion: 1 }), artifacts: [], events: [] };
    const { deps, plannerAgent } = buildDeps(store);
    plannerWritesPlan(store, plannerAgent, (opts) =>
      makePlan({ planVersion: (opts?.planVersionOverride as number) ?? 2, openQuestions: [] }),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runPlanning("run-1");

    expect(result.planVersion).toBe(2);
    expect(store.run.plannerRuntime).toBe("claude-code");
  });
});
