import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyError, ValidationError } from "../../src/utils/errors.js";
import type { Run, HumanAnswer } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/main",
    latestArtifactVersion: 0,
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
    summary: "Did the work",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "good",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "prev-1",
    summary: "Plan looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stateful fakes (mirror the real repositories' observable behavior so tests
// assert against the orchestrator's actual effects instead of brittle call
// sequencing).
// ---------------------------------------------------------------------------

function makeFakeRunRepo(initial: Run) {
  let current: Run = { ...initial };
  return {
    findById: vi.fn(async (id: string) => (id === current.id ? { ...current } : null)),
    findActiveByIssueId: vi.fn(async () => null),
    findByIssueId: vi.fn(async () => null),
    findAll: vi.fn(async () => [{ ...current }]),
    findRunsNeedingLinearBackfill: vi.fn(async () => []),
    create: vi.fn(async (params: Partial<Run>) => {
      current = { ...current, ...params, id: current.id };
      return { ...current };
    }),
    update: vi.fn(async (_id: string, data: Partial<Run>) => {
      current = { ...current, ...data };
      return { ...current };
    }),
    updateState: vi.fn(async (_id: string, state: RunState) => {
      current = { ...current, state };
      return { ...current };
    }),
    get current(): Run {
      return current;
    },
  };
}

interface FakeArtifact {
  id: string;
  runId: string;
  type: string;
  version: number;
  payloadJson: unknown;
  rawText: string;
  createdAt: Date;
}

function makeFakeArtifactRepo(seed: { type: string; payloadJson: unknown }[] = []) {
  const store: FakeArtifact[] = [];
  let seq = 0;
  const baseTime = Date.now() - 1_000_000;
  for (const s of seed) {
    store.push({
      id: `seed-${seq}`,
      runId: "run-1",
      type: s.type,
      version: 1,
      payloadJson: s.payloadJson,
      rawText: "{}",
      createdAt: new Date(baseTime + seq * 1000),
    });
    seq++;
  }
  return {
    create: vi.fn(async (params: Omit<FakeArtifact, "id" | "createdAt">) => {
      const artifact: FakeArtifact = {
        id: `artifact-${seq}`,
        createdAt: new Date(baseTime + seq * 1000 + 500_000),
        ...params,
      };
      seq++;
      store.push(artifact);
      return artifact;
    }),
    findByRunId: vi.fn(async () => [...store]),
    findLatestByType: vi.fn(async (_runId: string, type: string) => {
      const matches = store.filter((a) => a.type === type);
      return matches.length > 0 ? matches[matches.length - 1] : null;
    }),
    _store: store,
  };
}

interface FakeEvent {
  id: string;
  runId: string;
  eventType: string;
  source: string;
  payloadJson?: unknown;
  createdAt: Date;
}

function makeFakeEventRepo(seed: Partial<FakeEvent>[] = []) {
  const events: FakeEvent[] = [];
  let seq = 0;
  const baseTime = Date.now() - 1_000_000;
  for (const s of seed) {
    events.push({
      id: `seed-evt-${seq}`,
      runId: "run-1",
      eventType: "SEED",
      source: "seed",
      createdAt: new Date(baseTime + seq * 1000),
      ...s,
    });
    seq++;
  }
  return {
    create: vi.fn(async (params: Omit<FakeEvent, "id" | "createdAt">) => {
      const evt: FakeEvent = {
        id: `evt-${seq}`,
        createdAt: new Date(baseTime + seq * 1000 + 500_000),
        ...params,
      };
      seq++;
      events.push(evt);
      return evt;
    }),
    findByRunId: vi.fn(async () => [...events]),
    _events: events,
  };
}

function makeRepoEntry() {
  return {
    name: "test-repo",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [] as string[],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
  };
}

function buildDeps(opts: {
  run: Run;
  artifactSeed?: { type: string; payloadJson: unknown }[];
  eventSeed?: Partial<FakeEvent>[];
  overrides?: Record<string, unknown>;
}) {
  const runRepo = makeFakeRunRepo(opts.run);
  const artifactRepo = makeFakeArtifactRepo(opts.artifactSeed ?? []);
  const eventRepo = makeFakeEventRepo(opts.eventSeed ?? []);

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    getPRDiff: vi.fn().mockResolvedValue("diff --git a/a b/a"),
  };

  const repoEntry = makeRepoEntry();
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/main"),
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

  // The real agents persist their own artifacts as a side effect of run().
  // Since the agents themselves are mocked out here, the default mocks
  // replicate that persistence so the orchestrator's later
  // artifactRepo.findLatestByType(...) look-ups resolve the way they do in
  // production.
  const plannerAgent = {
    run: vi.fn(
      async (
        _bundle: unknown,
        runId: string,
        agentOpts?: { planVersionOverride?: number },
      ) => {
        const plan = makePlan({ planVersion: agentOpts?.planVersionOverride ?? 1 });
        await artifactRepo.create({
          runId,
          type: "Plan",
          version: plan.planVersion,
          payloadJson: plan,
          rawText: "{}",
        });
        return plan;
      },
    ),
  };
  const planReviewerAgent = {
    run: vi.fn(async (_plan: unknown, _bundle: unknown, runId: string) => {
      const planReview = makePlanReview();
      await artifactRepo.create({
        runId,
        type: "PlanReview",
        version: 1,
        payloadJson: planReview,
        rawText: "{}",
      });
      return planReview;
    }),
  };
  const planReviserAgent = {
    run: vi.fn(async (_plan: unknown, _review: unknown, _bundle: unknown, runId: string) => {
      const revisedPlan = makePlan({ planVersion: 2 });
      await artifactRepo.create({
        runId,
        type: "Plan",
        version: revisedPlan.planVersion,
        payloadJson: revisedPlan,
        rawText: "{}",
      });
      return { revision: { dispositions: [] }, revisedPlan };
    }),
  };
  const executorAgent = {
    run: vi.fn(async (_plan: unknown, _bundle: unknown, runId: string) => {
      const report = makeExecutionReport();
      await artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: "{}",
      });
      return { report, prNumber: 101 };
    }),
  };
  const reviewerAgent = {
    run: vi.fn(async (_plan: unknown, _report: unknown, _diff: unknown, _bundle: unknown, runId: string) => {
      const review = makeReview();
      await artifactRepo.create({
        runId,
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: "{}",
      });
      return review;
    }),
  };
  const remediationAgent = {
    run: vi.fn(async (_review: unknown, _report: unknown, _workingDir: unknown, runId: string) => {
      const remediation = {
        reviewId: "rev-1",
        resolution: [
          { findingId: "f1", status: "accepted", action: "fixed", rationale: "it was wrong" },
        ],
        readyForHumanReview: true,
        executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
      };
      await artifactRepo.create({
        runId,
        type: "ExecutionReport",
        version: remediation.executionReport.executionVersion,
        payloadJson: remediation.executionReport,
        rawText: "{}",
      });
      return remediation;
    }),
  };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1" }),
    incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1" }),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
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
    agentSkillRepo,
    distillationAgent,
    // answerResearcherAgent intentionally omitted by default: it is optional
    // in production, and most tests don't exercise the research path.
    ...(opts.overrides ?? {}),
  };

  return {
    deps,
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
    agentSkillRepo,
    distillationAgent,
  };
}

describe("OrchestratorService lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("handleLinearWebhook", () => {
    it("dispatches comment.command with a command to handleCommand", async () => {
      const run = makeRun({ state: RunState.Todo });
      const { deps, plannerAgent } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan() }],
      });
      const svc = new OrchestratorService(deps as never);
      const spy = vi.spyOn(svc, "startRun");

      await svc.handleLinearWebhook({
        action: "comment.command",
        issueId: "LIN-1",
        command: { type: "ai-plan" } as never,
      });

      expect(spy).toHaveBeenCalledWith("LIN-1");
      void plannerAgent;
    });

    it("ignores comment.command with no command payload", async () => {
      const run = makeRun();
      const { deps } = buildDeps({ run });
      const svc = new OrchestratorService(deps as never);
      const spy = vi.spyOn(svc, "handleCommand");

      await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

      expect(spy).not.toHaveBeenCalled();
    });

    it("no-ops for issue.created and issue.updated", async () => {
      const run = makeRun();
      const { deps } = buildDeps({ run });
      const svc = new OrchestratorService(deps as never);
      const spy = vi.spyOn(svc, "handleCommand");

      await svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" });
      await svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("handleCommand", () => {
    it("approve-plan: when an active run exists, approves the plan then runs execution", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, runRepo } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);

      // approvePlan -> Implementing, then runExecution -> ... -> ReadyForHumanReview
      expect(runRepo.current.state).toBe(RunState.ReadyForHumanReview);
    });

    it("approve-plan: no-ops when there is no active run for the issue", async () => {
      const run = makeRun();
      const { deps, runRepo } = buildDeps({ run });
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "approve-plan" } as never);

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });

    it("reject-plan: rejects the plan for the active run", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, runRepo, linearClient } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", {
        type: "reject-plan",
        body: "needs work",
      } as never);

      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("needs work"),
      );
    });

    it("re-review: re-runs code review for the active run", async () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 101 });
      const { deps, runRepo, reviewerAgent } = buildDeps({
        run,
        artifactSeed: [
          { type: "Plan", payloadJson: makePlan({ planVersion: 1 }) },
          { type: "ExecutionReport", payloadJson: makeExecutionReport() },
        ],
      });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "re-review" } as never);

      expect(reviewerAgent.run).toHaveBeenCalled();
    });

    it("pause-ai: transitions the active run to AIBlocked", async () => {
      const run = makeRun({ state: RunState.Planning });
      const { deps, runRepo } = buildDeps({ run });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai" } as never);

      expect(runRepo.current.state).toBe(RunState.AIBlocked);
    });

    it("resume-ai: resets the active run back to Todo", async () => {
      const run = makeRun({ state: RunState.AIBlocked });
      const { deps, runRepo } = buildDeps({ run });
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai" } as never);

      expect(runRepo.current.state).toBe(RunState.Todo);
    });

    it("unknown: logs a warning and takes no action", async () => {
      const run = makeRun();
      const { deps, logger, runRepo } = buildDeps({ run });
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "unknown" } as never);

      expect(logger.warn).toHaveBeenCalled();
      expect(runRepo.updateState).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("startRun", () => {
    it("returns the existing active run without creating a new one", async () => {
      const existing = makeRun({ id: "run-existing", state: RunState.Planning });
      const { deps, runRepo } = buildDeps({ run: existing });
      runRepo.findActiveByIssueId.mockResolvedValue(existing);
      const svc = new OrchestratorService(deps as never);

      const result = await svc.startRun("LIN-1");

      expect(result).toEqual(existing);
      expect(runRepo.create).not.toHaveBeenCalled();
    });

    it("pauses for human clarification when the plan has blocking open questions", async () => {
      const run = makeRun();
      const { deps, plannerAgent, runRepo } = buildDeps({ run });
      plannerAgent.run.mockResolvedValue(
        makePlan({
          openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
        }),
      );
      const svc = new OrchestratorService(deps as never);

      const result = await svc.startRun("LIN-1");

      expect(result.state).toBe(RunState.HumanClarificationNeeded);
      expect(runRepo.current.state).toBe(RunState.HumanClarificationNeeded);
    });

    it("drives a run with no blocking questions all the way to AwaitingPlanApproval", async () => {
      const run = makeRun();
      const { deps, runRepo, planReviewerAgent } = buildDeps({ run });
      const svc = new OrchestratorService(deps as never);

      const result = await svc.startRun("LIN-1");

      expect(planReviewerAgent.run).toHaveBeenCalled();
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      expect(runRepo.current.branchName).toBe("ai/run-1");
    });
  });

  // -------------------------------------------------------------------------
  describe("approvePlan", () => {
    it("throws when no plan artifact exists for the run", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval });
      const { deps } = buildDeps({ run });
      const svc = new OrchestratorService(deps as never);

      await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact/);
    });

    it("records the operator note in the approval comment when provided", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, linearClient } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      const svc = new OrchestratorService(deps as never);

      await svc.approvePlan("run-1", { note: "please hurry" });

      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("please hurry"),
      );
    });

    it("sets approvedPlanVersion and transitions to Implementing", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });
      const { deps, runRepo } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 3 }) }],
      });
      const svc = new OrchestratorService(deps as never);

      const result = await svc.approvePlan("run-1");

      expect(result.approvedPlanVersion).toBe(3);
      expect(runRepo.current.state).toBe(RunState.Implementing);
    });
  });

  // -------------------------------------------------------------------------
  describe("runExecution", () => {
    function implementingRun(overrides: Partial<Run> = {}) {
      return makeRun({
        state: RunState.Implementing,
        planVersion: 1,
        approvedPlanVersion: 1,
        branchName: "ai/run-1",
        ...overrides,
      });
    }

    it("rejects via policy when the run is not in Implementing state", async () => {
      const run = makeRun({ state: RunState.Todo });
      const { deps } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runExecution("run-1")).rejects.toThrow(/Cannot execute/);
    });

    it("on executor success, reaches ReadyForHumanReview via code review approval", async () => {
      const run = implementingRun();
      const { deps, runRepo, executorAgent } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      // Default reviewerAgent mock already returns + persists an "approved" Review.
      const svc = new OrchestratorService(deps as never);

      const result = await svc.runExecution("run-1");

      expect(executorAgent.run).toHaveBeenCalled();
      expect(result.state).toBe(RunState.ReadyForHumanReview);
      expect(runRepo.current.prNumber).toBe(101);
    });

    it("on executor AgentTimeoutError, records EXECUTION_TIMEOUT and blocks the run", async () => {
      const run = implementingRun();
      const { deps, runRepo, eventRepo, linearClient, executorAgent } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));
      const svc = new OrchestratorService(deps as never);

      const result = await svc.runExecution("run-1");

      expect(result.state).toBe(RunState.AIBlocked);
      expect(runRepo.current.state).toBe(RunState.AIBlocked);
      expect(eventRepo._events.some((e) => e.eventType === "EXECUTION_TIMEOUT")).toBe(true);
      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("timed out"),
      );
    });

    it("rethrows non-timeout executor errors without transitioning the run", async () => {
      const run = implementingRun();
      const { deps, runRepo, executorAgent } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      executorAgent.run.mockRejectedValue(new Error("boom"));
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
      expect(runRepo.current.state).toBe(RunState.Implementing);
    });

    it("recovers a stranded execution (report persisted but EXECUTION_FINISHED never recorded)", async () => {
      const run = implementingRun({ prNumber: 202 });
      const report = makeExecutionReport();
      const { deps, runRepo, executorAgent, eventRepo } = buildDeps({
        run,
        artifactSeed: [
          { type: "Plan", payloadJson: makePlan({ planVersion: 1 }) },
          { type: "ExecutionReport", payloadJson: report },
        ],
        eventSeed: [{ eventType: RunEvent.EXECUTION_STARTED as string, source: "orchestrator" }],
      });
      const svc = new OrchestratorService(deps as never);

      const result = await svc.runExecution("run-1");

      expect(executorAgent.run).not.toHaveBeenCalled();
      expect(
        eventRepo._events.some(
          (e) =>
            e.eventType === (RunEvent.EXECUTION_FINISHED as string) &&
            (e.payloadJson as { recovered?: boolean })?.recovered === true,
        ),
      ).toBe(true);
      expect(result.state).toBe(RunState.ReadyForHumanReview);
      expect(runRepo.current.prNumber).toBe(202);
    });
  });

  // -------------------------------------------------------------------------
  describe("runReview", () => {
    function aiReviewRun(overrides: Partial<Run> = {}) {
      return makeRun({ state: RunState.AIReview, prNumber: 101, ...overrides });
    }

    it("approved verdict transitions to ReadyForHumanReview via markReady", async () => {
      const run = aiReviewRun();
      const { deps, runRepo } = buildDeps({
        run,
        artifactSeed: [
          { type: "Plan", payloadJson: makePlan({ planVersion: 1 }) },
          { type: "ExecutionReport", payloadJson: makeExecutionReport() },
        ],
      });
      // Default reviewerAgent mock already returns + persists an "approved" Review.
      const svc = new OrchestratorService(deps as never);

      const result = await svc.runReview("run-1");

      expect(result.state).toBe(RunState.ReadyForHumanReview);
      expect(runRepo.current.reviewerRuntime).toBe("codex");
    });

    it("changes_requested verdict with PR findings posts them, then remediation fails the stale-review markReady check", async () => {
      // NOTE: this documents existing behavior rather than an intended happy
      // path. runRemediation() unconditionally calls markReady() at the end,
      // which re-reads the *stored* "Review" artifact. Nothing in
      // runReview/runRemediation ever persists a fresh "approved" Review
      // after remediation runs, so markReady's assertCanMarkReady policy
      // check is guaranteed to see the original "changes_requested" verdict
      // and throw. This looks like a latent bug worth flagging upstream.
      const run = aiReviewRun();
      const { deps, reviewerAgent, githubSync, artifactRepo } = buildDeps({
        run,
        artifactSeed: [
          { type: "Plan", payloadJson: makePlan({ planVersion: 1 }) },
          { type: "ExecutionReport", payloadJson: makeExecutionReport() },
        ],
      });
      reviewerAgent.run.mockImplementation(async (_plan, _report, _diff, _bundle, runId) => {
        const review = makeReview({
          overallVerdict: "changes_requested",
          findings: [
            {
              id: "f1",
              severity: "important",
              type: "bug",
              file: "src/a.ts",
              title: "Off by one",
              details: "loop bound wrong",
            },
          ],
        });
        await artifactRepo.create({
          runId: runId as string,
          type: "Review",
          version: 1,
          payloadJson: review,
          rawText: "{}",
        });
        return review;
      });
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot mark ready/);

      expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
        "test-repo",
        101,
        expect.any(Array),
        "changes_requested",
      );
    });

    it("skips posting review findings when the changes_requested verdict has zero findings", async () => {
      const run = aiReviewRun();
      const { deps, reviewerAgent, githubSync, artifactRepo } = buildDeps({
        run,
        artifactSeed: [
          { type: "Plan", payloadJson: makePlan({ planVersion: 1 }) },
          { type: "ExecutionReport", payloadJson: makeExecutionReport() },
        ],
      });
      reviewerAgent.run.mockImplementation(async (_plan, _report, _diff, _bundle, runId) => {
        const review = makeReview({ overallVerdict: "changes_requested", findings: [] });
        await artifactRepo.create({
          runId: runId as string,
          type: "Review",
          version: 1,
          payloadJson: review,
          rawText: "{}",
        });
        return review;
      });
      const svc = new OrchestratorService(deps as never);

      // assertCanRemediate requires at least one finding, so remediation
      // itself rejects -- but the findings-posting step never fires either.
      await expect(svc.runReview("run-1")).rejects.toThrow(/review findings/);
      expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    });

    it("rejects via policy when invoked outside of AIReview state", async () => {
      const run = makeRun({ state: RunState.Todo, prNumber: 101 });
      const { deps } = buildDeps({
        run,
        artifactSeed: [{ type: "ExecutionReport", payloadJson: makeExecutionReport() }],
      });
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot review/);
    });
  });

  // -------------------------------------------------------------------------
  describe("runRemediation", () => {
    it("pushes remediation commits and syncs GitHub, then hits the stale-review markReady policy check", async () => {
      // See the note on the equivalent runReview test above: markReady()
      // re-reads the stored "Review" artifact, which is never refreshed to
      // "approved" after remediation, so this always ends in a
      // PolicyViolationError. The commit/sync side effects before that point
      // still happen and are asserted here.
      const run = makeRun({
        state: RunState.AddressingReview,
        prNumber: 101,
        branchName: "ai/run-1",
      });
      const { deps, runRepo, gitService, githubSync } = buildDeps({
        run,
        artifactSeed: [
          {
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "changes_requested",
              findings: [
                {
                  id: "f1",
                  severity: "important",
                  type: "bug",
                  file: "a.ts",
                  title: "x",
                  details: "y",
                },
              ],
            }),
          },
          { type: "ExecutionReport", payloadJson: makeExecutionReport() },
        ],
      });
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runRemediation("run-1")).rejects.toThrow(/Cannot mark ready/);

      expect(gitService.commitAndPush).toHaveBeenCalled();
      expect(githubSync.postExecutionReportUpdate).toHaveBeenCalled();
      expect(githubSync.postRemediationResolutions).toHaveBeenCalled();
      expect(runRepo.current.remediationRuntime).toBe("claude-code");
      // The REVIEW_APPROVED transition (AIReview -> ReadyForHumanReview) is
      // recorded before markReady() runs and throws.
      expect(runRepo.current.state).toBe(RunState.ReadyForHumanReview);
    });

    it("rejects via policy when the review has no findings", async () => {
      const run = makeRun({ state: RunState.AddressingReview, prNumber: 101 });
      const { deps } = buildDeps({
        run,
        artifactSeed: [
          { type: "Review", payloadJson: makeReview({ overallVerdict: "changes_requested" }) },
          { type: "ExecutionReport", payloadJson: makeExecutionReport() },
        ],
      });
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runRemediation("run-1")).rejects.toThrow(/review findings/);
    });
  });

  // -------------------------------------------------------------------------
  describe("markReady", () => {
    it("rejects via policy when there are unresolved blocker findings", async () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 101 });
      const { deps } = buildDeps({
        run,
        artifactSeed: [
          {
            type: "Review",
            payloadJson: makeReview({
              overallVerdict: "approved",
              findings: [
                {
                  id: "f1",
                  severity: "blocker",
                  type: "bug",
                  file: "a.ts",
                  title: "x",
                  details: "y",
                },
              ],
            }),
          },
          { type: "ExecutionReport", payloadJson: makeExecutionReport() },
        ],
      });
      const svc = new OrchestratorService(deps as never);

      await expect(svc.markReady("run-1")).rejects.toThrow(/blocker/);
    });

    it("posts the completion comment when all policy checks pass", async () => {
      const run = makeRun({ state: RunState.AIReview, prNumber: 101 });
      const { deps, linearClient } = buildDeps({
        run,
        artifactSeed: [
          { type: "Review", payloadJson: makeReview({ overallVerdict: "approved" }) },
          { type: "ExecutionReport", payloadJson: makeExecutionReport() },
        ],
      });
      const svc = new OrchestratorService(deps as never);

      await svc.markReady("run-1");

      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("Ready for Human Review"),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("answerQuestions", () => {
    it("throws PolicyError when the run is not in an answerable state", async () => {
      const run = makeRun({ state: RunState.Implementing });
      const { deps } = buildDeps({ run });
      const svc = new OrchestratorService(deps as never);

      await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(PolicyError);
    });

    it("throws ValidationError for an answer referencing an unknown questionId", async () => {
      const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
      const { deps } = buildDeps({
        run,
        artifactSeed: [
          {
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }],
            }),
          },
        ],
      });
      const svc = new OrchestratorService(deps as never);

      await expect(
        svc.answerQuestions("run-1", [{ questionId: "bogus", answer: "x" }]),
      ).rejects.toThrow(ValidationError);
    });

    it("AwaitingPlanApproval: records answers without re-planning", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, plannerAgent, artifactRepo } = buildDeps({
        run,
        artifactSeed: [
          {
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: false }],
            }),
          },
        ],
      });
      const svc = new OrchestratorService(deps as never);

      const answers: HumanAnswer[] = [{ questionId: "q1", answer: "staging" }];
      const result = await svc.answerQuestions("run-1", answers);

      expect(plannerAgent.run).not.toHaveBeenCalled();
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      expect(artifactRepo._store.some((a) => a.type === "HumanAnswers")).toBe(true);
    });

    it("HumanClarificationNeeded: throws ValidationError when required questions are unanswered", async () => {
      const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
      const { deps } = buildDeps({
        run,
        artifactSeed: [
          {
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [
                { id: "q1", question: "Which?", requiredForExecution: true },
                { id: "q2", question: "When?", requiredForExecution: true },
              ],
            }),
          },
        ],
      });
      const svc = new OrchestratorService(deps as never);

      await expect(
        svc.answerQuestions("run-1", [{ questionId: "q1", answer: "staging" }]),
      ).rejects.toThrow(/Missing answers/);
    });

    it("HumanClarificationNeeded: re-plans and proceeds to plan review once unblocked", async () => {
      const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
      const { deps, plannerAgent, planReviewerAgent } = buildDeps({
        run,
        artifactSeed: [
          {
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }],
            }),
          },
          { type: "TaskBundle", payloadJson: { repo: {}, issue: {} } },
        ],
      });
      plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
      const svc = new OrchestratorService(deps as never);

      const result = await svc.answerQuestions("run-1", [
        { questionId: "q1", answer: "staging" },
      ]);

      expect(planReviewerAgent.run).toHaveBeenCalled();
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
    });

    it("HumanClarificationNeeded: re-raises clarification when still blocked (under max iterations)", async () => {
      const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
      const stillBlocked = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
      });
      const { deps, plannerAgent, runRepo } = buildDeps({
        run,
        artifactSeed: [
          {
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }],
            }),
          },
          { type: "TaskBundle", payloadJson: { repo: {}, issue: {} } },
        ],
        eventSeed: [{ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string, source: "seed" }],
      });
      plannerAgent.run.mockResolvedValue(stillBlocked);
      const svc = new OrchestratorService(deps as never);

      const result = await svc.answerQuestions("run-1", [
        { questionId: "q1", answer: "staging" },
      ]);

      expect(result.state).toBe(RunState.HumanClarificationNeeded);
      expect(runRepo.current.state).toBe(RunState.HumanClarificationNeeded);
    });

    it("HumanClarificationNeeded: fails the run once max clarification iterations are exhausted", async () => {
      const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
      const stillBlocked = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
      });
      const { deps, plannerAgent, runRepo } = buildDeps({
        run,
        artifactSeed: [
          {
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }],
            }),
          },
          { type: "TaskBundle", payloadJson: { repo: {}, issue: {} } },
        ],
        eventSeed: [
          { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string, source: "seed" },
          { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string, source: "seed" },
          { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string, source: "seed" },
        ],
      });
      plannerAgent.run.mockResolvedValue(stillBlocked);
      const svc = new OrchestratorService(deps as never);

      const result = await svc.answerQuestions("run-1", [
        { questionId: "q1", answer: "staging" },
      ]);

      expect(result.state).toBe(RunState.Failed);
      expect(runRepo.current.state).toBe(RunState.Failed);
    });
  });

  // -------------------------------------------------------------------------
  describe("runManualReReview", () => {
    it("always returns to AwaitingPlanApproval regardless of verdict (approved)", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, planReviewerAgent } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
      const svc = new OrchestratorService(deps as never);

      const result = await svc.runManualReReview("run-1");

      expect(result.state).toBe(RunState.AwaitingPlanApproval);
    });

    it("always returns to AwaitingPlanApproval regardless of verdict (changes_requested)", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, planReviewerAgent, planReviserAgent } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      planReviewerAgent.run.mockResolvedValue(
        makePlanReview({ overallVerdict: "changes_requested" }),
      );
      const svc = new OrchestratorService(deps as never);

      const result = await svc.runManualReReview("run-1");

      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      expect(planReviserAgent.run).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("runManualPlanRevision", () => {
    it("approved verdict: no revision necessary, settles on AwaitingPlanApproval", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, planReviewerAgent, planReviserAgent } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
      const svc = new OrchestratorService(deps as never);

      const result = await svc.runManualPlanRevision("run-1");

      expect(planReviserAgent.run).not.toHaveBeenCalled();
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
    });

    it("changes_requested verdict: drives an explicit plan revision", async () => {
      const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, planReviewerAgent, planReviserAgent } = buildDeps({
        run,
        artifactSeed: [{ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }],
      });
      planReviewerAgent.run.mockResolvedValue(
        makePlanReview({ overallVerdict: "changes_requested" }),
      );
      const svc = new OrchestratorService(deps as never);

      const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

      expect(planReviserAgent.run).toHaveBeenCalled();
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
    });
  });

  // -------------------------------------------------------------------------
  describe("approveHumanReview", () => {
    it("runs distillation, then transitions to Done and cleans up the worktree", async () => {
      const run = makeRun({
        state: RunState.ReadyForHumanReview,
        workingDirectory: "/tmp/main/worktrees/run-1",
      });
      const { deps, distillationAgent, gitService, linearClient, runRepo, agentSkillRepo } =
        buildDeps({
          run,
          eventSeed: [
            {
              eventType: "SKILL_INJECTION",
              source: "orchestrator",
              payloadJson: { skillIds: ["skill-1"] },
            },
          ],
        });
      gitService.resolveMainRepoPath.mockReturnValue("/tmp/main");
      const svc = new OrchestratorService(deps as never);

      const result = await svc.approveHumanReview("run-1");

      expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
      expect(result.state).toBe(RunState.Done);
      expect(gitService.removeWorktree).toHaveBeenCalledWith(
        "/tmp/main",
        "/tmp/main/worktrees/run-1",
      );
      expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
      expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalled();
      expect(linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("Done"),
      );
      expect(runRepo.current.state).toBe(RunState.Done);
    });

    it("continues to Done even when the distillation agent throws (best-effort)", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview });
      const { deps, distillationAgent, logger } = buildDeps({ run });
      distillationAgent.run.mockRejectedValue(new Error("distillation exploded"));
      const svc = new OrchestratorService(deps as never);

      const result = await svc.approveHumanReview("run-1");

      expect(result.state).toBe(RunState.Done);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "distillation exploded" }),
        expect.stringContaining("Distillation agent failed"),
      );
    });

    it("does not clean up the worktree when workingDirectory is already the main repo path", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/main" });
      const { deps, gitService } = buildDeps({ run });
      gitService.resolveMainRepoPath.mockReturnValue("/tmp/main");
      const svc = new OrchestratorService(deps as never);

      await svc.approveHumanReview("run-1");

      expect(gitService.removeWorktree).not.toHaveBeenCalled();
    });

    it("skips skill metric updates when no skills were injected for the run", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview });
      const { deps, agentSkillRepo } = buildDeps({ run });
      const svc = new OrchestratorService(deps as never);

      await svc.approveHumanReview("run-1");

      expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
      expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    });

    it("logs (but tolerates) a failure updating an individual skill's metrics", async () => {
      const run = makeRun({ state: RunState.ReadyForHumanReview });
      const { deps, agentSkillRepo, logger } = buildDeps({
        run,
        eventSeed: [
          {
            eventType: "SKILL_INJECTION",
            source: "orchestrator",
            payloadJson: { skillIds: ["skill-1"] },
          },
        ],
      });
      agentSkillRepo.incrementSuccess.mockRejectedValue(new Error("db down"));
      const svc = new OrchestratorService(deps as never);

      const result = await svc.approveHumanReview("run-1");

      expect(result.state).toBe(RunState.Done);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ skillId: "skill-1", error: "db down" }),
        expect.stringContaining("Failed to update skill metric"),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("retrieveSkillsForPlanning (via startRun)", () => {
    it("records a SKILL_INJECTION event when the skill repo returns matches", async () => {
      const run = makeRun();
      const { deps, agentSkillRepo, eventRepo } = buildDeps({ run });
      agentSkillRepo.findTopKByRelevance.mockResolvedValue([
        { id: "skill-9", repoSlug: "test-repo" } as never,
      ]);
      const svc = new OrchestratorService(deps as never);

      await svc.startRun("LIN-1");

      expect(
        eventRepo._events.some(
          (e) =>
            e.eventType === "SKILL_INJECTION" &&
            (e.payloadJson as { skillIds: string[] }).skillIds.includes("skill-9"),
        ),
      ).toBe(true);
    });

    it("returns no skills and records no event when agentSkillRepo is not configured", async () => {
      const run = makeRun();
      const { deps, eventRepo } = buildDeps({ run, overrides: { agentSkillRepo: undefined } });
      const svc = new OrchestratorService(deps as never);

      await svc.startRun("LIN-1");

      expect(eventRepo._events.some((e) => e.eventType === "SKILL_INJECTION")).toBe(false);
    });
  });
});
