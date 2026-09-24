import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { Remediation } from "../../src/schemas/remediation.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Test issue",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
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
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented things.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Solid implementation.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "plan-rev-1",
    summary: "Plan looks solid",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeRemediation(overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed it", rationale: "Real bug" },
    ],
    readyForHumanReview: true,
    executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
    ...overrides,
  };
}

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}-${Math.random().toString(36).slice(2)}`,
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

function buildHarness(initialRun: Run, initialArtifacts: Artifact[] = []) {
  const store: TestStore = { run: initialRun, artifacts: [...initialArtifacts], events: [] };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
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
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
      rawText: string;
    }) => {
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
    create: vi.fn().mockImplementation((params: {
      runId: string;
      eventType: string;
      source: string;
      payloadJson?: unknown;
    }) => {
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
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/foo b/foo"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
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
    getDefaultRepo: vi.fn().mockReturnValue({
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
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  // Mirrors the real PlannerAgent: persists a Plan artifact as a side effect
  // of run() so downstream findLatestByType(runId, "Plan") lookups succeed.
  const plannerAgent = {
    run: vi.fn().mockImplementation(async (_bundle: unknown, runId: string, options?: { planVersionOverride?: number }) => {
      const plan = makePlan({ planVersion: options?.planVersionOverride ?? 1 });
      store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
      return plan;
    }),
  };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
  // Mirrors the real ExecutorAgent: persists an ExecutionReport artifact as a
  // side effect of run().
  const executorAgent = {
    run: vi.fn().mockImplementation(async () => {
      const report = makeExecutionReport();
      store.artifacts.push(
        asArtifact({ type: "ExecutionReport", version: report.executionVersion, payloadJson: report }),
      );
      return { report, prNumber: 101 };
    }),
  };
  // Mirrors the real ReviewerAgent: persists a Review artifact as a side
  // effect of run().
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review = makeReview();
      store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
      return review;
    }),
  };
  const remediationAgent = { run: vi.fn().mockResolvedValue(makeRemediation()) };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
  const answerResearcherAgent: { run: ReturnType<typeof vi.fn> } | undefined = undefined;

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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

  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    displaceAndCreate: vi.fn(),
    findById: vi.fn(),
    findLowestUtilityActive: vi.fn(),
    archiveById: vi.fn(),
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.5 }),
    incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.1 }),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
  };

  return {
    store,
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
      answerResearcherAgent,
      logger,
      dashboardEmitter,
      agentSkillRepo,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    githubSync,
    linearSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    distillationAgent,
    gitService,
    logger,
    dashboardEmitter,
    agentSkillRepo,
    repoRegistry,
  };
}

/**
 * Overrides plannerAgent.run's next resolved value while preserving the
 * artifact-persistence side effect the default implementation provides (the
 * real PlannerAgent always writes a Plan artifact as part of run()).
 */
function mockPlannerPlan(h: ReturnType<typeof buildHarness>, plan: Plan): void {
  h.plannerAgent.run.mockImplementationOnce(async () => {
    h.store.artifacts.push(asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan }));
    return plan;
  });
}

/**
 * Overrides reviewerAgent.run's next resolved value while preserving the
 * artifact-persistence side effect the default implementation provides (the
 * real ReviewerAgent always writes a Review artifact as part of run()).
 */
function mockReviewerReview(h: ReturnType<typeof buildHarness>, review: Review): void {
  h.reviewerAgent.run.mockImplementationOnce(async () => {
    h.store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
    return review;
  });
}

describe("OrchestratorService.runPlanning", () => {
  it("happy path: re-plans, records PLAN_CREATED, and proceeds to plan review when no blockers", async () => {
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      asArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: { summary: "prior review", findings: [] },
      }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    mockPlannerPlan(h, makePlan({ planVersion: 2 }));

    const result = await svc.runPlanning("run-1");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        planReviewFindings: { summary: "prior review", findings: [] },
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for human clarification when the re-plan still has blocking open questions", async () => {
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 1 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    mockPlannerPlan(
      h,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("passes previousPlan, rejectionContext, humanAnswers, and researchedAnswers when those artifacts exist", async () => {
    const initialRun = makeRun({ state: RunState.Planning, planVersion: 3 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 3, payloadJson: makePlan({ planVersion: 3 }) }),
      asArtifact({
        type: "RejectionContext",
        version: 3,
        payloadJson: { planVersion: 3, feedback: "Use OAuth2", source: "api", mode: "iterate" },
      }),
      asArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
      }),
      asArtifact({
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: {
          summary: "s",
          completedAt: new Date().toISOString(),
          answers: [
            { questionId: "q2", question: "Q?", answer: "A", confidence: "high" as const },
          ],
        },
      }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    mockPlannerPlan(h, makePlan({ planVersion: 4 }));

    await svc.runPlanning("run-1");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 4,
        previousPlan: expect.objectContaining({ planVersion: 3 }),
        humanFeedback: { planVersion: 3, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          expect.objectContaining({ questionId: "q2", answer: "A" }),
        ],
      }),
    );
  });
});

describe("OrchestratorService.retryRun", () => {
  it("happy path: sets up a new worktree when branchName is absent, re-plans, proceeds to plan review", async () => {
    const initialRun = makeRun({ state: RunState.Todo, branchName: null, planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    mockPlannerPlan(h, makePlan({ planVersion: 1 }));

    const result = await svc.retryRun("run-1");

    expect(h.gitService.setupRunWorktree).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when branchName is already present", async () => {
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    mockPlannerPlan(h, makePlan({ planVersion: 1 }));

    await svc.retryRun("run-1");

    expect(h.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the plan has blocking open questions", async () => {
    const initialRun = makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 1 });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);
    mockPlannerPlan(
      h,
      makePlan({
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, transitions to AwaitingPlanApproval, and posts a combined comment", async () => {
    const initialRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      asArtifact({
        type: "PlanReview",
        version: 1,
        payloadJson: makePlanReview({ overallVerdict: "changes_requested" }),
      }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.runPlanRevision("run-1");

    expect(h.planReviserAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.objectContaining({ overallVerdict: "changes_requested" }),
      expect.anything(),
      "run-1",
      undefined,
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan Revision Dispositions"),
    );
  });

  it("passes an operatorNote through to the plan reviser when opts.note is provided", async () => {
    const initialRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
      asArtifact({ type: "PlanReview", version: 1, payloadJson: makePlanReview() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    await svc.runPlanRevision("run-1", { note: "please simplify" });

    expect(h.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify" },
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const h = buildHarness(initialRun);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("sets approvedPlanVersion, transitions to Implementing, and posts a plain approval comment", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.approvePlan("run-1");

    expect(result.state).toBe(RunState.Implementing);
    expect(result.approvedPlanVersion).toBe(2);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v2 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    await svc.approvePlan("run-1", { note: "Go ahead" });

    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("approved with operator note"),
    );
    expect(h.linearClient.postComment).toHaveBeenCalledWith("LIN-1", expect.stringContaining("Go ahead"));
  });
});

describe("OrchestratorService.runExecution", () => {
  it("happy path: checkpoints, runs the executor, transitions to AIReview, and proceeds through review to ReadyForHumanReview", async () => {
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.runExecution("run-1");

    expect(h.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("checkpoint before executor run"),
    );
    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
    // Default reviewerAgent mock returns an approved verdict with no findings,
    // so the flow proceeds all the way to ReadyForHumanReview via markReady().
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
  });

  it("skips the checkpoint commit when the run has no branchName", async () => {
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    await svc.runExecution("run-1");

    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("catches AgentTimeoutError: records EXECUTION_TIMEOUT, transitions to AIBlocked, posts a timeout comment, and returns without throwing", async () => {
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    const timeoutEvent = h.store.events.find((e) => e.eventType === "EXECUTION_TIMEOUT");
    expect(timeoutEvent).toBeDefined();
    expect((timeoutEvent!.payloadJson as { agent: string; timeoutMs: number }).agent).toBe(
      "executor",
    );
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Executor timed out"),
    );
  });

  it("re-throws non-timeout errors from the executor", async () => {
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    h.executorAgent.run.mockRejectedValue(new Error("boom"));

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("crash recovery: skips re-running the executor when a stranded ExecutionReport is found without a matching EXECUTION_FINISHED", async () => {
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      prNumber: 55,
    });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    // EXECUTION_STARTED happened before the stranded report was written; no
    // EXECUTION_FINISHED was ever recorded (process crash between report
    // persistence and the state transition).
    const startedAt = new Date("2024-01-01T00:00:00.000Z");
    h.store.events.push({
      id: "evt-started",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
      payloadJson: {},
      createdAt: startedAt,
    });
    h.store.artifacts.push({
      id: "artifact-report-stranded",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      rawText: "{}",
      createdAt: new Date("2024-01-01T00:05:00.000Z"),
    });

    const result = await svc.runExecution("run-1");

    expect(h.executorAgent.run).not.toHaveBeenCalled();
    const recoveredEvent = h.store.events.find(
      (e) => e.eventType === RunEvent.EXECUTION_FINISHED,
    );
    expect(recoveredEvent).toBeDefined();
    expect((recoveredEvent!.payloadJson as { recovered: boolean }).recovered).toBe(true);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", prNumber: 55 }),
      expect.stringContaining("Recovered stranded execution"),
    );
    // Proceeds straight into review using the recovered report.
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does NOT trigger crash recovery when EXECUTION_FINISHED was already recorded after the report", async () => {
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      prNumber: 55,
    });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    const startedAt = new Date("2024-01-01T00:00:00.000Z");
    const reportAt = new Date("2024-01-01T00:05:00.000Z");
    const finishedAt = new Date("2024-01-01T00:06:00.000Z");
    h.store.events.push(
      {
        id: "evt-started",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: startedAt,
      },
      {
        id: "evt-finished",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_FINISHED,
        source: "executor-agent",
        payloadJson: {},
        createdAt: finishedAt,
      },
    );
    h.store.artifacts.push({
      id: "artifact-report-old",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      rawText: "{}",
      createdAt: reportAt,
    });

    await svc.runExecution("run-1");

    // A previous cycle already finished cleanly, so the orchestrator re-runs
    // the executor for this new attempt rather than treating it as stranded.
    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("throws PolicyViolationError when the executor touches a protected path", async () => {
    const initialRun = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    h.repoRegistry.getRepoByName.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: ["secrets/"],
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    const svc = new OrchestratorService(h.deps as never);
    h.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: ["secrets/keys.json"] }),
      prNumber: 101,
    });

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.runReview", () => {
  it("approved verdict: transitions to ReadyForHumanReview via markReady, without posting review findings to GitHub", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 77 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    mockReviewerReview(h, makeReview({ overallVerdict: "approved" }));

    const result = await svc.runReview("run-1");

    expect(h.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("changes_requested verdict with findings and a PR: posts review findings to GitHub and runs remediation", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 77 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/foo.ts",
          title: "Bug",
          details: "Real issue",
        },
      ],
    });
    mockReviewerReview(h, review);
    h.githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 555]]));

    // The Review artifact's verdict stays "changes_requested" even after
    // remediation runs (the mocked RemediationAgent does not update it, and
    // neither does the real one -- see orchestratorService.executionScore.test.ts),
    // so markReady() at the end of the remediation lane throws. We assert the
    // interesting interactions here rather than a final "ready" state.
    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);

    expect(h.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      77,
      review.findings,
      "changes_requested",
    );
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI Code Review"),
    );
    expect(h.remediationAgent.run).toHaveBeenCalledTimes(1);
  });

  it("changes_requested verdict with zero findings: does NOT call postReviewFindings", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 77 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);
    mockReviewerReview(h, makeReview({ overallVerdict: "changes_requested", findings: [] }));

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
    expect(h.githubSync.postReviewFindings).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("skips assertBranch/commitAndPush when the run has no branchName", async () => {
    const initialRun = makeRun({
      state: RunState.AddressingReview,
      branchName: null,
      prNumber: 77,
    });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      asArtifact({
        type: "Review",
        version: 1,
        payloadJson: makeReview({
          overallVerdict: "changes_requested",
          findings: [
            {
              id: "f1",
              severity: "important",
              type: "bug",
              file: "src/foo.ts",
              title: "Bug",
              details: "d",
            },
          ],
        }),
      }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    // markReady will fail afterwards because the Review artifact's verdict is
    // still "changes_requested" (a pre-existing quirk documented in
    // orchestratorService.executionScore.test.ts) -- we only assert the
    // branch-skip behaviour here.
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(h.gitService.assertBranch).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("skips GitHub sync calls when the run has no prNumber", async () => {
    const initialRun = makeRun({
      state: RunState.AddressingReview,
      branchName: "ai/run-1",
      prNumber: null,
    });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      asArtifact({
        type: "Review",
        version: 1,
        payloadJson: makeReview({
          overallVerdict: "changes_requested",
          findings: [
            {
              id: "f1",
              severity: "important",
              type: "bug",
              file: "src/foo.ts",
              title: "Bug",
              details: "d",
            },
          ],
        }),
      }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);

    expect(h.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(h.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment when all preconditions are satisfied", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 77 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      asArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved" }) }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.markReady("run-1");

    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
    expect(result.id).toBe("run-1");
  });

  it("throws ready_requires_review when no Review artifact exists", async () => {
    const initialRun = makeRun({ state: RunState.AIReview, prNumber: 77 });
    const h = buildHarness(initialRun, [
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(h.deps as never);

    try {
      await svc.markReady("run-1");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });
});
