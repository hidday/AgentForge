import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
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

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  app.log.error = vi.fn() as never;
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  await app.ready();
  return { app, mockRunRepo, mockOrchestrator };
}

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires runManualReReview and returns { ok: true, runId } immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "  check again  " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "check again",
    });
  });

  it("logs but does not fail the request when runManualReReview rejects asynchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("Re-review blew up"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "Re-review blew up" }),
      "Manual re-review failed",
    );
  });

  it("returns 400 when the synchronous call throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("Cannot re-review in this state");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Cannot re-review in this state" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires runManualPlanRevision and returns { ok: true, runId } immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "please tweak step 2" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "please tweak step 2",
    });
  });

  it("logs but does not fail the request when runManualPlanRevision rejects asynchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("Revision blew up"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "Revision blew up" }),
      "Manual plan revision failed",
    );
  });

  it("returns 400 when the synchronous call throws a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw "nope";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "nope" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns 400 naming retryable states when the run's state is not retryable", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain(RunState.Todo);
    expect(body.error).toContain(RunState.Implementing);
  });

  const retryCases: { state: RunState; orchestratorMethod: string }[] = [
    { state: RunState.Todo, orchestratorMethod: "retryRun" },
    { state: RunState.Planning, orchestratorMethod: "runPlanning" },
    { state: RunState.PlanRevision, orchestratorMethod: "runPlanRevision" },
    { state: RunState.PlanReview, orchestratorMethod: "runPlanReview" },
    { state: RunState.Implementing, orchestratorMethod: "runExecution" },
    { state: RunState.AIReview, orchestratorMethod: "runReview" },
    { state: RunState.AddressingReview, orchestratorMethod: "runRemediation" },
  ];

  for (const { state, orchestratorMethod } of retryCases) {
    it(`retries state "${state}" via orchestrator.${orchestratorMethod} and returns retrying: true`, async () => {
      const run = makeRun({ state });
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      (mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[
        orchestratorMethod
      ].mockResolvedValue(undefined);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(
        (mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[orchestratorMethod],
      ).toHaveBeenCalledWith("run-1");
    });
  }

  it("logs but does not fail the request when the retry trigger rejects asynchronously", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("Retry execution blew up"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "Retry execution blew up" }),
      "Retry stage failed",
    );
  });
});
