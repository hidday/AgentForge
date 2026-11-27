import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { Remediation } from "../../src/schemas/remediation.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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
    prNumber: 42,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Reviewed",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeRemediation(executionReport: ExecutionReport, overrides: Partial<Remediation> = {}): Remediation {
  return {
    reviewId: "rev-1",
    resolution: [
      { findingId: "f1", status: "accepted", action: "Fixed", rationale: "Real bug" },
    ],
    readyForHumanReview: true,
    executionReport,
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
  runFields: Partial<Run>;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function makeStore(initial: Partial<TestStore> = {}): TestStore {
  return { runState: RunState.Todo, runFields: {}, artifacts: [], events: [], ...initial };
}

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() =>
      Promise.resolve({ ...initialRun, ...store.runFields, state: store.runState }),
    ),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => {
      store.runFields = { ...store.runFields, ...params };
      store.runState = RunState.Todo;
      return Promise.resolve({ ...initialRun, ...store.runFields, state: store.runState, id: "run-1" });
    }),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, ...store.runFields, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Record<string, unknown>) => {
      store.runFields = { ...store.runFields, ...data };
      return Promise.resolve({ ...initialRun, ...store.runFields, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation(
      (params: { runId: string; type: string; version: number; payloadJson: unknown; rawText: string }) => {
        const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
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
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(Date.now() + store.events.length),
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
      branchName: "ai/run-test1",
      labels: [],
      priority: 0,
      project: undefined,
      cycle: undefined,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
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
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/main"),
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

  // Mimics the real PlannerAgent, which persists the Plan artifact itself.
  const plannerAgent = {
    run: vi.fn().mockImplementation(
      async (_bundle: TaskBundle, runId: string, opts?: { planVersionOverride?: number }) => {
        const plan = makePlan({ planVersion: opts?.planVersionOverride ?? 1, openQuestions: [] });
        await artifactRepo.create({
          runId,
          type: "Plan",
          version: plan.planVersion,
          payloadJson: plan,
          rawText: JSON.stringify(plan),
        });
        return plan;
      },
    ),
  };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "OK", findings: [] }),
  };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
  // Mimics the real ExecutorAgent, which persists the ExecutionReport artifact itself.
  const executorAgent = {
    run: vi.fn().mockImplementation(async (_plan: Plan, _bundle: TaskBundle, runId: string) => {
      const report = makeExecutionReport();
      await artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 42 };
    }),
  };
  // Mimics the real ReviewerAgent, which persists the Review artifact itself.
  const reviewerAgent = {
    run: vi.fn().mockImplementation(async (_plan: Plan, _execReport: ExecutionReport, _diff: string, _bundle: TaskBundle, runId: string) => {
      const review = makeReview();
      await artifactRepo.create({
        runId,
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: JSON.stringify(review),
      });
      return review;
    }),
  };
  const remediationAgent = {
    run: vi.fn().mockImplementation(async (_review: Review, executionReport: ExecutionReport) => {
      const newReport = makeExecutionReport({ executionVersion: executionReport.executionVersion + 1 });
      const remediation = makeRemediation(newReport);
      await artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: newReport.executionVersion,
        payloadJson: newReport,
        rawText: JSON.stringify(newReport),
      });
      await artifactRepo.create({
        runId: "run-1",
        type: "Remediation",
        version: 1,
        payloadJson: remediation,
        rawText: JSON.stringify(remediation),
      });
      return remediation;
    }),
  };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/main"),
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

  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const deps = {
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
    distillationAgent,
    ...overrides,
  };

  return {
    deps,
    store,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    gitService,
    logger,
    dashboardEmitter,
    distillationAgent,
  };
}

// ---------------------------------------------------------------------------
// handleLinearWebhook
// ---------------------------------------------------------------------------

describe("OrchestratorService.handleLinearWebhook", () => {
  it("issue.created is a no-op", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });

    expect(built.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("issue.updated is a no-op", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(built.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });

  it("comment.command with a command dispatches handleCommand", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "unknown", body: "" } as never,
    });

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });

  it("comment.command without a command attached does nothing", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(built.runRepo.findActiveByIssueId).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCommand
// ---------------------------------------------------------------------------

describe("OrchestratorService.handleCommand", () => {
  it("ai-plan starts a run", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "ai-plan" } as never);

    expect(built.runRepo.create).toHaveBeenCalled();
  });

  it("run-ai also starts a run", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "run-ai" } as never);

    expect(built.runRepo.create).toHaveBeenCalled();
  });

  it("approve-plan approves the active run and starts execution", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);

    const svc = new OrchestratorService(built.deps as never);
    await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);

    expect(store.events.some((e) => e.eventType === RunEvent.PLAN_APPROVED)).toBe(true);
    expect(built.executorAgent.run).toHaveBeenCalled();
  });

  it("approve-plan is a no-op when there is no active run", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);

    expect(built.executorAgent.run).not.toHaveBeenCalled();
  });

  it("reject-plan rejects the plan on the active run", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);

    const svc = new OrchestratorService(built.deps as never);
    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs changes" } as never);

    expect(store.events.some((e) => e.eventType === RunEvent.PLAN_REJECTED)).toBe(true);
  });

  it("reject-plan is a no-op when there is no active run", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" } as never);

    expect(built.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("re-review triggers a code review re-run on the active run", async () => {
    const store = makeStore({ runState: RunState.AIReview });
    store.artifacts.push(
      asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    );
    const run = makeRun({ state: RunState.AIReview });
    const built = buildDeps(store, run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);

    const svc = new OrchestratorService(built.deps as never);
    await svc.handleCommand("LIN-1", { type: "re-review" } as never);

    expect(built.reviewerAgent.run).toHaveBeenCalled();
  });

  it("re-review is a no-op when there is no active run", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "re-review" } as never);

    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("pause-ai blocks the active run", async () => {
    const store = makeStore({ runState: RunState.Planning });
    const run = makeRun({ state: RunState.Planning });
    const built = buildDeps(store, run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);

    const svc = new OrchestratorService(built.deps as never);
    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);

    expect(store.runState).toBe(RunState.AIBlocked);
  });

  it("pause-ai is a no-op when there is no active run", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);

    expect(built.eventRepo.create).not.toHaveBeenCalled();
  });

  it("resume-ai resets the active run to Todo", async () => {
    const store = makeStore({ runState: RunState.AIBlocked });
    const run = makeRun({ state: RunState.AIBlocked });
    const built = buildDeps(store, run);
    built.runRepo.findActiveByIssueId.mockResolvedValue(run);

    const svc = new OrchestratorService(built.deps as never);
    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);

    expect(store.runState).toBe(RunState.Todo);
  });

  it("resume-ai is a no-op when there is no active run", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);

    expect(built.eventRepo.create).not.toHaveBeenCalled();
  });

  it("logs a warning for an unknown command type", async () => {
    const store = makeStore();
    const built = buildDeps(store, makeRun());
    const svc = new OrchestratorService(built.deps as never);

    await svc.handleCommand("LIN-1", { type: "unknown" } as never);

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});

// ---------------------------------------------------------------------------
// answerQuestions -- remaining branches
// ---------------------------------------------------------------------------

describe("OrchestratorService.answerQuestions additional branches", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const store = makeStore({ runState: RunState.HumanClarificationNeeded });
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const built = buildDeps(store, run);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }])).rejects.toThrow(
      /No plan artifact found/,
    );
  });

  it("throws when there is no TaskBundle artifact for the run (HumanClarificationNeeded path)", async () => {
    const store = makeStore({ runState: RunState.HumanClarificationNeeded });
    store.artifacts.push(
      asArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
      }),
    );
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const built = buildDeps(store, run);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }])).rejects.toThrow(
      /No TaskBundle artifact found/,
    );
  });

  it("returns to HumanClarificationNeeded (without failing) when blockers remain but the iteration limit has not been reached", async () => {
    const store = makeStore({ runState: RunState.HumanClarificationNeeded });
    store.artifacts.push(
      asArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
      }),
      asArtifact({ type: "TaskBundle", version: 1, payloadJson: {} }),
    );
    // Only one prior clarification round -- below MAX_CLARIFICATION_ITERATIONS (3).
    store.events.push({
      id: "ev-1",
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
      source: "planner-agent",
      payloadJson: {},
      createdAt: new Date(),
    });
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const built = buildDeps(store, run);
    built.plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "maybe" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const lastEvent = store.events[store.events.length - 1];
    expect(lastEvent.eventType).toBe(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect((lastEvent.payloadJson as { iteration: number }).iteration).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// runManualReReview / runManualPlanRevision -- missing-artifact branches
// ---------------------------------------------------------------------------

describe("OrchestratorService.runManualReReview missing-plan branch", () => {
  it("throws when there is no Plan artifact", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, run);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualPlanRevision missing-plan branch", () => {
  it("throws when there is no Plan artifact", async () => {
    const store = makeStore({ runState: RunState.AwaitingPlanApproval });
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store, run);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

// ---------------------------------------------------------------------------
// formatExecutionReportComment branches (zero files, many files, notes)
// ---------------------------------------------------------------------------

describe("OrchestratorService execution report comment formatting", () => {
  it("omits the files-changed section when no files changed, and includes notes when present", async () => {
    const store = makeStore({ runState: RunState.Implementing });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const run = makeRun({ state: RunState.Implementing, branchName: null });
    const built = buildDeps(store, run);
    built.executorAgent.run.mockImplementation(async (_plan: Plan, _bundle: TaskBundle, runId: string) => {
      const report = makeExecutionReport({ filesChanged: [], notes: ["Watch out for flaky test X"] });
      await built.artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 42 };
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )?.[1] as string;

    expect(comment).toBeDefined();
    expect(comment).not.toContain("Files changed");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Watch out for flaky test X");
  });

  it("collapses the files-changed section inside <details> when there are more than 8 files", async () => {
    const store = makeStore({ runState: RunState.Implementing });
    store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }));
    const run = makeRun({ state: RunState.Implementing, branchName: null });
    const built = buildDeps(store, run);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    built.executorAgent.run.mockImplementation(async (_plan: Plan, _bundle: TaskBundle, runId: string) => {
      const report = makeExecutionReport({ filesChanged: manyFiles });
      await built.artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: JSON.stringify(report),
      });
      return { report, prNumber: 42 };
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )?.[1] as string;

    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
  });
});

// ---------------------------------------------------------------------------
// updateSkillMetrics -- failure branch
// ---------------------------------------------------------------------------

describe("OrchestratorService updateSkillMetrics failure branch", () => {
  it("increments failure counts for injected skills when a run fails", async () => {
    const store = makeStore({ runState: RunState.HumanClarificationNeeded });
    store.artifacts.push(
      asArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] }),
      }),
      asArtifact({ type: "TaskBundle", version: 1, payloadJson: {} }),
    );
    // Three prior clarification rounds -- at MAX_CLARIFICATION_ITERATIONS, so the
    // next pass (still blocked) fails the run.
    for (let i = 0; i < 3; i++) {
      store.events.push({
        id: `ev-${i}`,
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      });
    }
    store.events.push({
      id: "ev-skill",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-x"] },
      createdAt: new Date(),
    });
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const agentSkillRepo = {
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-x", successCount: 0, failureCount: 1, utilityScore: 0 }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const built = buildDeps(store, run, { agentSkillRepo });
    built.plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-x");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});
