import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import { AgentTimeoutError } from "../../src/utils/errors.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "Some description",
    linearIssueTitle: "Some title",
    linearIssueUrl: "https://linear.app/issue/LIN-1",
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
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Plan summary",
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implementation done",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "all good",
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

interface StoredEvent {
  id: string;
  runId: string;
  eventType: string;
  source: string;
  payloadJson: unknown;
  createdAt: Date;
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: StoredEvent[];
}

let artifactCounter = 0;
let eventCounter = 0;

function asArtifact(overrides: {
  type: string;
  version: number;
  payloadJson: unknown;
  id?: string;
  createdAt?: Date;
}): Artifact {
  return {
    id: overrides.id ?? `artifact-${overrides.type}-${overrides.version}-${artifactCounter++}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: overrides.createdAt ?? new Date(),
  };
}

const repoEntry = {
  name: "test-repo",
  defaultBranch: "main",
  allowedPaths: ["src/"],
  protectedPaths: [],
  constraints: {
    requiredChecks: [],
    maxFilesChanged: 100,
    maxDiffLines: 5000,
    forbiddenPatterns: [],
    mustNotTouch: [],
  },
};

function buildDeps(
  store: TestStore,
  opts: {
    plannerAgentRun?: ReturnType<typeof vi.fn>;
    planReviewerAgentRun?: ReturnType<typeof vi.fn>;
    planReviserAgentRun?: ReturnType<typeof vi.fn>;
    executorAgentRun?: ReturnType<typeof vi.fn>;
    reviewerAgentRun?: ReturnType<typeof vi.fn>;
    remediationAgentRun?: ReturnType<typeof vi.fn>;
    findActiveByIssueId?: ReturnType<typeof vi.fn>;
    getDefaultBranch?: ReturnType<typeof vi.fn>;
    getRelatedContext?: ReturnType<typeof vi.fn>;
    getPRDiff?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: opts.findActiveByIssueId ?? vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation((params: Partial<Run>) => {
      store.run = { ...store.run, ...params, id: store.run.id };
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
      const a = asArtifact(params);
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
      const e: StoredEvent = {
        id: `event-${eventCounter++}`,
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
      title: "Some title",
      description: "Some description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
      project: "proj",
      team: "team",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: opts.getRelatedContext ?? vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: opts.getPRDiff ?? vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: opts.getDefaultBranch ?? vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/work"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: opts.plannerAgentRun ?? vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = {
    run: opts.planReviewerAgentRun ?? vi.fn().mockResolvedValue(makePlanReview()),
  };
  const planReviserAgent = {
    run: opts.planReviserAgentRun ?? vi.fn(),
  };
  const executorAgent = {
    run: opts.executorAgentRun ??
      vi.fn().mockImplementation(() => {
        const report = makeExecutionReport();
        store.artifacts.push(
          asArtifact({ type: "ExecutionReport", version: report.executionVersion, payloadJson: report }),
        );
        return Promise.resolve({ report, prNumber: 101 });
      }),
  };
  const reviewerAgent = {
    run: opts.reviewerAgentRun ??
      vi.fn().mockImplementation(() => {
        const review = makeReview();
        store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
        return Promise.resolve(review);
      }),
  };
  const remediationAgent = { run: opts.remediationAgentRun ?? vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockImplementation((wd: string) => wd),
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
    githubClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    githubSync,
    logger,
  };
}

describe("OrchestratorService -- simple getters", () => {
  it("exposes injected dependencies via getters", () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    expect(svc.getRunRepo()).toBe(built.runRepo);
    expect(svc.getArtifactRepo()).toBe(built.artifactRepo);
    expect(svc.getEventRepo()).toBe(built.eventRepo);
    expect(svc.getLinearClient()).toBe(built.linearClient);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.handleLinearWebhook", () => {
  it("dispatches comment.command payloads to handleCommand", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi
      .spyOn(svc, "handleCommand")
      .mockResolvedValue(undefined);

    await svc.handleLinearWebhook({
      action: "comment.command",
      issueId: "LIN-1",
      command: { type: "ai-plan" },
    });

    expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "ai-plan" });
  });

  it("does nothing further for comment.command without a command payload", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for issue.created and issue.updated actions", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

    await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
    await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

    expect(handleCommandSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.handleCommand", () => {
  function setup(findActiveByIssueId?: ReturnType<typeof vi.fn>) {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store, { findActiveByIssueId });
    const svc = new OrchestratorService(built.deps as never);
    return { store, built, svc };
  }

  it("ai-plan and run-ai both call startRun", async () => {
    const { svc } = setup();
    const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "ai-plan" });
    await svc.handleCommand("LIN-1", { type: "run-ai" });

    expect(startRunSpy).toHaveBeenCalledTimes(2);
    expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
  });

  it("approve-plan calls approvePlan then runExecution when an active run exists", async () => {
    const active = makeRun({ id: "active-1" });
    const { svc } = setup(vi.fn().mockResolvedValue(active));
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(active);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(active);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("active-1");
    expect(runExecutionSpy).toHaveBeenCalledWith("active-1");
  });

  it("approve-plan does nothing when there is no active run", async () => {
    const { svc } = setup(vi.fn().mockResolvedValue(null));
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).not.toHaveBeenCalled();
  });

  it("reject-plan calls rejectPlan with the command body when an active run exists", async () => {
    const active = makeRun({ id: "active-1" });
    const { svc } = setup(vi.fn().mockResolvedValue(active));
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(active);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs changes" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("active-1", "needs changes", "linear");
  });

  it("reject-plan does nothing when there is no active run", async () => {
    const { svc } = setup(vi.fn().mockResolvedValue(null));
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "x" });

    expect(rejectPlanSpy).not.toHaveBeenCalled();
  });

  it("re-review calls runReview when an active run exists", async () => {
    const active = makeRun({ id: "active-1" });
    const { svc } = setup(vi.fn().mockResolvedValue(active));
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(active);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("active-1");
  });

  it("re-review does nothing when there is no active run", async () => {
    const { svc } = setup(vi.fn().mockResolvedValue(null));
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).not.toHaveBeenCalled();
  });

  it("pause-ai transitions the active run via BLOCKED", async () => {
    const active = makeRun({ id: "active-1", state: RunState.Implementing });
    const { store, svc } = setup(vi.fn().mockResolvedValue(active));
    store.run = active;

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(store.run.state).toBe(RunState.AIBlocked);
  });

  it("pause-ai does nothing when there is no active run", async () => {
    const { store, svc } = setup(vi.fn().mockResolvedValue(null));
    const originalState = store.run.state;

    await svc.handleCommand("LIN-1", { type: "pause-ai" });

    expect(store.run.state).toBe(originalState);
  });

  it("resume-ai transitions the active run via RESET_TO_TODO", async () => {
    const active = makeRun({ id: "active-1", state: RunState.AIBlocked });
    const { store, svc } = setup(vi.fn().mockResolvedValue(active));
    store.run = active;

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(store.run.state).toBe(RunState.Todo);
  });

  it("resume-ai does nothing when there is no active run", async () => {
    const { store, svc } = setup(vi.fn().mockResolvedValue(null));
    const originalState = store.run.state;

    await svc.handleCommand("LIN-1", { type: "resume-ai" });

    expect(store.run.state).toBe(originalState);
  });

  it("logs a warning for an unknown command and does nothing else", async () => {
    const { built, svc } = setup();

    await svc.handleCommand("LIN-1", { type: "unknown" });

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1" }),
      "Unknown command received",
    );
  });
});

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const existing = makeRun({ id: "existing-1", state: RunState.Planning });
    const store: TestStore = { run: existing, artifacts: [], events: [] };
    const built = buildDeps(store, { findActiveByIssueId: vi.fn().mockResolvedValue(existing) });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(built.runRepo.create).not.toHaveBeenCalled();
  });

  it("creates a run, plans it, and reaches AwaitingPlanApproval when the plan review approves", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Todo }), artifacts: [], events: [] };
    const plan = makePlan({ planVersion: 1, openQuestions: [] });
    const built = buildDeps(store, {
      plannerAgentRun: vi.fn().mockImplementation(() => {
        store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
        return Promise.resolve(plan);
      }),
      planReviewerAgentRun: vi.fn().mockResolvedValue(makePlanReview({ overallVerdict: "approved" })),
      // Exercise buildTaskBundle's "remote branch differs" warn branch and the
      // relatedContext-present branch at the same time.
      getDefaultBranch: vi.fn().mockResolvedValue("develop"),
      getRelatedContext: vi.fn().mockResolvedValue({
        parent: { id: "P-1", title: "Parent", description: "d", state: "Todo", labels: [], priority: 0 },
        blockers: [],
      }),
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(built.runRepo.create).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.RUN_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_APPROVED);
  });

  it("stops at HumanClarificationNeeded when the plan has a blocking open question", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Todo }), artifacts: [], events: [] };
    const blockingPlan = makePlan({
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
    });
    const built = buildDeps(store, {
      plannerAgentRun: vi.fn().mockResolvedValue(blockingPlan),
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("routes through plan revision when the AI plan review requests changes", async () => {
    const store: TestStore = { run: makeRun({ state: RunState.Todo }), artifacts: [], events: [] };
    const plan = makePlan({ planVersion: 1 });
    const revisedPlan = makePlan({ planVersion: 2 });
    const built = buildDeps(store, {
      plannerAgentRun: vi.fn().mockImplementation(() => {
        store.artifacts.push(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
        return Promise.resolve(plan);
      }),
      planReviewerAgentRun: vi.fn().mockImplementation(() => {
        const pr = makePlanReview({ overallVerdict: "changes_requested" });
        store.artifacts.push(asArtifact({ type: "PlanReview", version: 1, payloadJson: pr }));
        return Promise.resolve(pr);
      }),
      planReviserAgentRun: vi.fn().mockResolvedValue({
        revision: {
          originalPlanVersion: 1,
          revisedPlanVersion: 2,
          reviewId: "pr-1",
          dispositions: [{ findingId: "f1", status: "accepted", rationale: "fair point" }],
        },
        revisedPlan,
      }),
      // Exercise buildTaskBundle's catch branches (both best-effort fallbacks).
      getDefaultBranch: vi.fn().mockRejectedValue(new Error("github unreachable")),
      getRelatedContext: vi.fn().mockRejectedValue(new Error("linear unreachable")),
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(built.planReviserAgent?.run).toBeDefined();
    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVISED);
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("records the approved plan version and transitions to Implementing", async () => {
    const plan = makePlan({ planVersion: 4 });
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 4 }),
      artifacts: [asArtifact({ type: "Plan", version: 4, payloadJson: plan })],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan("run-1", { note: "go for it" });

    expect(result.state).toBe(RunState.Implementing);
    expect(result.approvedPlanVersion).toBe(4);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("go for it"),
    );
  });

  it("throws when there is no plan artifact for the run", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.AwaitingPlanApproval }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found");
  });
});

describe("OrchestratorService.runExecution / runReview / markReady (cascading happy path)", () => {
  function buildExecutableStore(overrides: Partial<Run> = {}) {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      run: makeRun({
        state: RunState.Implementing,
        approvedPlanVersion: 1,
        prNumber: null,
        ...overrides,
      }),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    return { store, plan };
  }

  it("executes, reviews (approved), and marks the run ready for human review", async () => {
    const { store } = buildExecutableStore();
    const built = buildDeps(store, {
      reviewerAgentRun: vi.fn().mockImplementation(() => {
        const review = makeReview({ overallVerdict: "approved" });
        store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
        return Promise.resolve(review);
      }),
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.EXECUTION_STARTED);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Execution Report"),
    );
  });

  it("routes to remediation when the code review requests changes", async () => {
    const { store } = buildExecutableStore();
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" },
      ],
    });
    const built = buildDeps(store, {
      reviewerAgentRun: vi.fn().mockImplementation(() => {
        store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
        return Promise.resolve(review);
      }),
      remediationAgentRun: vi.fn().mockImplementation(() => {
        const newReport = makeExecutionReport({ executionVersion: 2 });
        const remediation = {
          reviewId: "rev-1",
          resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "r" }],
          readyForHumanReview: true,
          executionReport: newReport,
        };
        store.artifacts.push(
          asArtifact({ type: "ExecutionReport", version: 2, payloadJson: newReport }),
        );
        store.artifacts.push(asArtifact({ type: "Remediation", version: 1, payloadJson: remediation }));
        return Promise.resolve(remediation);
      }),
    });
    const svc = new OrchestratorService(built.deps as never);

    // The only Review artifact on record still says "changes_requested", so
    // the final markReady() call (invoked by runRemediation) is expected to
    // throw on the verdict check -- that is out of scope here; what this test
    // verifies is that the remediation lane itself ran and transitioned state
    // correctly before that point.
    await expect(svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "ready_requires_approved_verdict",
    });

    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.REVIEW_CHANGES_REQUESTED);
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    // Remediation always re-marks REVIEW_APPROVED after finishing.
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
    expect(store.run.state).toBe(RunState.ReadyForHumanReview);
    expect(built.githubSync.postReviewFindings).toHaveBeenCalled();
  });

  it("pauses the run with BLOCKED when the executor times out", async () => {
    const { store } = buildExecutableStore();
    const built = buildDeps(store, {
      executorAgentRun: vi.fn().mockRejectedValue(new AgentTimeoutError("executor", 600_000)),
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain("EXECUTION_TIMEOUT");
  });

  it("rethrows non-timeout executor errors", async () => {
    const { store } = buildExecutableStore();
    const built = buildDeps(store, {
      executorAgentRun: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("recovers a stranded execution (report exists, EXECUTION_FINISHED never recorded) by skipping the executor", async () => {
    const { store, plan } = buildExecutableStore({ prNumber: 55 });
    void plan;
    store.artifacts.push(
      asArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: new Date("2024-01-01T00:00:10Z"),
      }),
    );
    store.events.push({
      id: "evt-started",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    const built = buildDeps(store, {
      reviewerAgentRun: vi.fn().mockImplementation(() => {
        const review = makeReview({ overallVerdict: "approved" });
        store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
        return Promise.resolve(review);
      }),
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    const eventTypes = store.events.map((e) => e.eventType);
    expect(eventTypes).toContain(RunEvent.EXECUTION_FINISHED);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("re-runs the executor when the existing report predates the last EXECUTION_STARTED event", async () => {
    const { store } = buildExecutableStore({ prNumber: 55 });
    // Report is OLDER than the last EXECUTION_STARTED event -> not a stranded
    // recovery candidate, so the executor must run again.
    store.artifacts.push(
      asArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
        createdAt: new Date("2024-01-01T00:00:00Z"),
      }),
    );
    store.events.push({
      id: "evt-started",
      runId: "run-1",
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date("2024-01-01T00:00:10Z"),
    });

    const built = buildDeps(store, {
      reviewerAgentRun: vi.fn().mockImplementation(() => {
        const review = makeReview({ overallVerdict: "approved" });
        store.artifacts.push(asArtifact({ type: "Review", version: 1, payloadJson: review }));
        return Promise.resolve(review);
      }),
    });
    const svc = new OrchestratorService(built.deps as never);

    await svc.runExecution("run-1");

    expect(built.executorAgent.run).toHaveBeenCalledTimes(1);
  });
});
