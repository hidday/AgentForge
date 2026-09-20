import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Add feature",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
    repo: "acme/repo",
    branchName: "feature-branch",
    prNumber: 42,
    state: RunState.AwaitingPlanApproval,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function makeArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface BuildAppOptions {
  runRepoOverrides?: Record<string, unknown>;
  artifactRepoOverrides?: Record<string, unknown>;
  eventRepoOverrides?: Record<string, unknown>;
  orchestratorOverrides?: Record<string, unknown>;
  processRunnerOverrides?: Record<string, unknown>;
  withLinearPollService?: boolean;
  linearPollServiceOverrides?: Record<string, unknown>;
}

async function buildApp(opts: BuildAppOptions = {}) {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    ...opts.runRepoOverrides,
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    ...opts.artifactRepoOverrides,
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    ...opts.eventRepoOverrides,
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: () => null,
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    ...opts.orchestratorOverrides,
  };

  const mockEmitter = {
    on: vi.fn(),
    off: vi.fn(),
    emitChatReply: vi.fn(),
  };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
    ...opts.processRunnerOverrides,
  };

  const mockLinearPollService = opts.withLinearPollService
    ? {
        discoverPendingIssues: vi.fn().mockResolvedValue([]),
        startRunsForIssues: vi.fn().mockResolvedValue({ started: [], skipped: [] }),
        ...opts.linearPollServiceOverrides,
      }
    : undefined;

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    mockLinearPollService as never,
  );

  await app.ready();
  return {
    app,
    mockRunRepo,
    mockArtifactRepo,
    mockEventRepo,
    mockOrchestrator,
    mockEmitter,
    mockProcessRunner,
    mockLinearPollService,
  };
}

describe("GET /api/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all runs when no state filter is given", async () => {
    const runs = [makeRun({ id: "r1" }), makeRun({ id: "r2" })];
    const { app, mockRunRepo } = await buildApp({
      runRepoOverrides: { findAll: vi.fn().mockResolvedValue(runs) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    expect(res.json().runs).toHaveLength(2);
  });

  it("passes the state query parameter through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();

    await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Run not found");
  });

  it("returns the run with its artifacts and events", async () => {
    const run = makeRun();
    const artifacts = [makeArtifact()];
    const events = [{ id: "e1", runId: "run-1", eventType: "RUN_STARTED", source: "api", payloadJson: {}, createdAt: new Date() }];
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findByRunId: vi.fn().mockResolvedValue(artifacts) },
      eventRepoOverrides: { findByRunId: vi.fn().mockResolvedValue(events) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toHaveLength(1);
    expect(body.events).toHaveLength(1);
    expect(mockRunRepo.findById).toHaveBeenCalledWith("run-1");
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
  });

  it("returns artifacts for an existing run", async () => {
    const run = makeRun();
    const artifacts = [makeArtifact(), makeArtifact({ id: "artifact-2", version: 2 })];
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findByRunId: vi.fn().mockResolvedValue(artifacts) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json().artifacts).toHaveLength(2);
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
  });

  it("returns events for an existing run", async () => {
    const run = makeRun();
    const events = [{ id: "e1", runId: "run-1", eventType: "RUN_STARTED", source: "api", payloadJson: {}, createdAt: new Date() }];
    const { app, mockRunRepo, mockEventRepo } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      eventRepoOverrides: { findByRunId: vi.fn().mockResolvedValue(events) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(1);
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves the plan, kicks off execution in the background, and returns the new state", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: { approvePlan: vi.fn().mockResolvedValue(run) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "  looks good  " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("returns 400 when approvePlan rejects", async () => {
    const { app } = await buildApp({
      orchestratorOverrides: {
        approvePlan: vi.fn().mockRejectedValue(new Error("Plan already approved")),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Plan already approved");
  });

  it("does not fail the request even if the background execution run rejects", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app } = await buildApp({
      orchestratorOverrides: {
        approvePlan: vi.fn().mockResolvedValue(run),
        runExecution: vi.fn().mockRejectedValue(new Error("boom")),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("triggers a manual re-review and returns immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please double check" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please double check",
    });
  });

  it("returns 400 when triggering the re-review throws synchronously", async () => {
    const { app } = await buildApp({
      orchestratorOverrides: {
        runManualReReview: vi.fn(() => {
          throw new Error("cannot re-review in this state");
        }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot re-review in this state");
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("triggers a manual plan revision and returns immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tighten scope" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "tighten scope",
    });
  });

  it("returns 400 when triggering the revision throws synchronously", async () => {
    const { app } = await buildApp({
      orchestratorOverrides: {
        runManualPlanRevision: vi.fn(() => {
          throw new Error("cannot revise in this state");
        }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot revise in this state");
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves the human review and returns the new state", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: { approveHumanReview: vi.fn().mockResolvedValue(run) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 when approveHumanReview rejects", async () => {
    const { app } = await buildApp({
      orchestratorOverrides: {
        approveHumanReview: vi.fn().mockRejectedValue(new Error("not ready for review")),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not ready for review");
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(res.statusCode).toBe(404);
  });

  it("sends a pause-ai command for the run's linear issue", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand rejects", async () => {
    const run = makeRun();
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      orchestratorOverrides: { handleCommand: vi.fn().mockRejectedValue(new Error("already paused")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("already paused");
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(res.statusCode).toBe(404);
  });

  it("sends a resume-ai command for the run's linear issue", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand rejects", async () => {
    const run = makeRun();
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      orchestratorOverrides: { handleCommand: vi.fn().mockRejectedValue(new Error("not paused")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not paused");
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a state that cannot be retried", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app } = await buildApp({ runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) } });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Retry is not supported for state");
  });

  const cases: [RunState, string][] = [
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ];

  for (const [state, method] of cases) {
    it(`retries state ${state} via orchestrator.${method}`, async () => {
      const run = makeRun({ state });
      const { app, mockOrchestrator } = await buildApp({
        runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      });

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect((mockOrchestrator as Record<string, unknown>)[method]).toHaveBeenCalledWith("run-1");
    });
  }

  it("does not fail the request even if the background retry action rejects", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      orchestratorOverrides: { retryRun: vi.fn().mockRejectedValue(new Error("boom")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns nulls for plan/planReview/review/executionReport when none exist", async () => {
    const run = makeRun();
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findLatestByType: vi.fn().mockResolvedValue(null) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.linearIssue.identifier).toBe("ENG-1");
  });

  it("builds a full summary, normalizing string, object, and unknown-shaped risks", async () => {
    const run = makeRun();
    const circular: Record<string, unknown> = { foo: "bar" };
    circular.self = circular; // triggers JSON.stringify to throw -> falls back to String(r)

    const planArtifact = makeArtifact({
      type: "Plan",
      version: 5,
      payloadJson: {
        summary: "Add login",
        confidence: 0.8,
        openQuestions: [{ id: "q1", question: "OAuth or password?", requiredForExecution: true }],
        steps: [{ id: "s1", title: "Add route", description: "Add /login route" }],
        risks: ["plain string risk", { description: "object risk" }, { noDescription: true }, circular],
        testPlan: "Run e2e tests",
      },
    });
    const planReviewArtifact = makeArtifact({ id: "pr-1", type: "PlanReview", version: 2, payloadJson: { verdict: "approve" } });
    const reviewArtifact = makeArtifact({ id: "rv-1", type: "Review", version: 1, payloadJson: { verdict: "approve" } });
    const executionArtifact = makeArtifact({
      id: "ex-1",
      type: "ExecutionReport",
      version: 3,
      payloadJson: { executionVersion: 3, score: 0.95, scoreRationale: "All tests pass" },
    });

    const findLatestByType = vi.fn().mockImplementation((_runId: string, type: string) => {
      switch (type) {
        case "Plan":
          return Promise.resolve(planArtifact);
        case "PlanReview":
          return Promise.resolve(planReviewArtifact);
        case "Review":
          return Promise.resolve(reviewArtifact);
        case "ExecutionReport":
          return Promise.resolve(executionArtifact);
        default:
          return Promise.resolve(null);
      }
    });

    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findLatestByType },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.plan.version).toBe(5);
    expect(body.plan.summary).toBe("Add login");
    expect(body.plan.confidence).toBe(0.8);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Add route", description: "Add /login route" }]);
    expect(body.plan.riskCount).toBe(4);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ noDescription: true }));
    expect(body.plan.risks[3]).toBe(String(circular));

    expect(body.planReview).toEqual({ version: 2, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.executionReport).toEqual({
      version: 3,
      executionVersion: 3,
      score: 0.95,
      scoreRationale: "All tests pass",
      payload: { executionVersion: 3, score: 0.95, scoreRationale: "All tests pass" },
    });
  });

  it("falls back executionVersion to the artifact version when payload omits it", async () => {
    const run = makeRun();
    const executionArtifact = makeArtifact({
      id: "ex-2",
      type: "ExecutionReport",
      version: 7,
      payloadJson: {},
    });
    const findLatestByType = vi.fn().mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "ExecutionReport" ? executionArtifact : null),
    );
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findLatestByType },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    expect(res.json().executionReport.executionVersion).toBe(7);
  });

  it("defaults openQuestions to [] when the plan payload omits it", async () => {
    const run = makeRun();
    const planArtifact = makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "x" } });
    const findLatestByType = vi.fn().mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? planArtifact : null),
    );
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findLatestByType },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
  });
});

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId filter is given", async () => {
    const processes = [
      { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planning" },
      { id: "p2", pid: 2, command: "claude", runId: "run-2", stage: "planning" },
    ];
    const { app } = await buildApp({
      processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) },
    });

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toHaveLength(2);
  });

  it("filters active processes by runId", async () => {
    const processes = [
      { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planning" },
      { id: "p2", pid: 2, command: "claude", runId: "run-2", stage: "planning" },
    ];
    const { app } = await buildApp({
      processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) },
    });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].runId).toBe("run-2");
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when there is no output for the process", async () => {
    const { app } = await buildApp({
      processRunnerOverrides: { getProcessOutput: vi.fn().mockReturnValue(null) },
    });

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
  });

  it("returns the process output when available", async () => {
    const { app } = await buildApp({
      processRunnerOverrides: { getProcessOutput: vi.fn().mockReturnValue("stdout text") },
    });

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "stdout text" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPollService: false });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
  });

  it("returns pending issues when configured", async () => {
    const issues = [{ id: "LIN-9", identifier: "ENG-9" }];
    const { app } = await buildApp({
      withLinearPollService: true,
      linearPollServiceOverrides: { discoverPendingIssues: vi.fn().mockResolvedValue(issues) },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json().issues).toEqual(issues);
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const { app } = await buildApp({
      withLinearPollService: true,
      linearPollServiceOverrides: {
        discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API down")),
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Linear API down");
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPollService: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing", async () => {
    const { app } = await buildApp({ withLinearPollService: true });

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("issueIds");
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const { app } = await buildApp({ withLinearPollService: true });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("starts runs for the given issue ids", async () => {
    const { app, mockLinearPollService } = await buildApp({
      withLinearPollService: true,
      linearPollServiceOverrides: {
        startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(mockLinearPollService!.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const { app } = await buildApp({
      withLinearPollService: true,
      linearPollServiceOverrides: {
        startRunsForIssues: vi.fn().mockRejectedValue(new Error("db unavailable")),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("db unavailable");
  });
});

// The SSE route writes directly to the raw Node response and never resolves
// via reply.send(), so it can't be driven through app.inject() (which waits
// for the response to finish). Instead we capture the registered handler and
// invoke it directly with minimal fake request/reply objects, which lets us
// assert on the actual headers/writes/subscribe-unsubscribe behavior.
type StreamHandler = (request: { raw: EventEmitter }, reply: { raw: { writeHead: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } }) => void;

function buildStreamHandler() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn().mockResolvedValue([]) };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]), findLatestByType: vi.fn().mockResolvedValue(null), create: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() };
  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: () => null,
  };
  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  let handler: StreamHandler | undefined;
  const originalGet = app.get.bind(app);
  vi.spyOn(app, "get").mockImplementation(((path: unknown, ...rest: unknown[]) => {
    if (path === "/api/events/stream") {
      handler = rest[rest.length - 1] as StreamHandler;
    }
    return (originalGet as (...a: unknown[]) => unknown)(path, ...rest);
  }) as typeof app.get);

  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  if (!handler) throw new Error("Failed to capture the /api/events/stream handler");
  return { handler, mockEmitter };
}

function makeRawRes() {
  return { writeHead: vi.fn(), write: vi.fn() };
}

describe("GET /api/events/stream", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("writes SSE headers and an initial comment, and forwards dashboard events as SSE data frames", () => {
    const { handler, mockEmitter } = buildStreamHandler();
    const rawReq = new EventEmitter();
    const rawRes = makeRawRes();

    handler({ raw: rawReq }, { raw: rawRes });

    expect(rawRes.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(rawRes.write).toHaveBeenCalledWith(":\n\n");

    expect(mockEmitter.on).toHaveBeenCalledTimes(1);
    const [eventName, dashboardHandler] = mockEmitter.on.mock.calls[0] as [
      string,
      (event: unknown) => void,
    ];
    expect(eventName).toBe("dashboard");
    expect(typeof dashboardHandler).toBe("function");

    const event = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "acme/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    dashboardHandler(event);

    expect(rawRes.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("writes a heartbeat comment every 15 seconds while connected", () => {
    vi.useFakeTimers();
    const { handler } = buildStreamHandler();
    const rawReq = new EventEmitter();
    const rawRes = makeRawRes();

    handler({ raw: rawReq }, { raw: rawRes });
    rawRes.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(rawRes.write).toHaveBeenCalledWith(":\n\n");

    rawRes.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(rawRes.write).toHaveBeenCalledWith(":\n\n");
  });

  it("clears the heartbeat interval and unsubscribes the exact handler when the client disconnects", () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const { handler, mockEmitter } = buildStreamHandler();
    const rawReq = new EventEmitter();
    const rawRes = makeRawRes();

    handler({ raw: rawReq }, { raw: rawRes });
    const [, dashboardHandler] = mockEmitter.on.mock.calls[0] as [string, (event: unknown) => void];

    rawReq.emit("close");

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    // After disconnect, the heartbeat must no longer fire.
    rawRes.write.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(rawRes.write).not.toHaveBeenCalled();
  });
});
