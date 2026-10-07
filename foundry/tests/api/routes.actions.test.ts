import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(state: RunState, overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueTitle: "Add login",
    linearIssueUrl: null,
    linearIssueDescription: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state,
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

async function buildApp(orchestratorOverrides: Record<string, unknown> = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
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
    ...orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockOrchestrator, mockRunRepo };
}

// Give pending promise rejections (fire-and-forget .catch chains) a tick to settle.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves the plan, triggers execution in the background, and returns the new state", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "Looks good" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "Looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith(run.id, { note: "Looks good" });
  });

  it("returns 400 when approvePlan rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Run is not awaiting approval"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Run is not awaiting approval" });
    expect(mockOrchestrator.runExecution).not.toHaveBeenCalled();
  });

  it("logs but does not throw when the background runExecution() rejects", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await flush();
    // No unhandled rejection should escape; nothing further to assert beyond
    // the request succeeding and the background call having been attempted.
    expect(mockOrchestrator.runExecution).toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("kicks off runManualReReview in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please re-check",
    });
  });

  it("logs but returns 200 when the background runManualReReview() rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("failed"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await flush();
  });

  it("returns 400 when runManualReReview throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("synchronous failure");
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "synchronous failure" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("kicks off runManualPlanRevision in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "add more detail" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "add more detail",
    });
  });

  it("logs but returns 200 when the background runManualPlanRevision() rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("failed"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await flush();
  });

  it("returns 400 when runManualPlanRevision throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("synchronous failure");
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "synchronous failure" });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with the new state on success", async () => {
    const run = makeRun(RunState.Done);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when approveHumanReview rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("Wrong state"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Wrong state" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(response.statusCode).toBe(404);
  });

  it("calls handleCommand with pause-ai and returns ok on success", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand rejects", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "cannot pause" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(response.statusCode).toBe(404);
  });

  it("calls handleCommand with resume-ai and returns ok on success", async () => {
    const run = makeRun(RunState.AIBlocked);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand rejects", async () => {
    const run = makeRun(RunState.AIBlocked);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "cannot resume" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for a non-retryable state (e.g. Done)", async () => {
    const run = makeRun(RunState.Done);
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain("Retryable states:");
  });

  const retryableCases: { state: RunState; method: string }[] = [
    { state: RunState.Todo, method: "retryRun" },
    { state: RunState.Planning, method: "runPlanning" },
    { state: RunState.PlanRevision, method: "runPlanRevision" },
    { state: RunState.PlanReview, method: "runPlanReview" },
    { state: RunState.Implementing, method: "runExecution" },
    { state: RunState.AIReview, method: "runReview" },
    { state: RunState.AddressingReview, method: "runRemediation" },
  ];

  for (const { state, method } of retryableCases) {
    it(`triggers orchestrator.${method}() in the background for state ${state}`, async () => {
      const run = makeRun(state);
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      (mockOrchestrator[method] as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; runId: string; state: string; retrying: boolean };
      expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(mockOrchestrator[method]).toHaveBeenCalledWith("run-1");
    });
  }

  it("logs the error but still returns 200 when the background retry trigger rejects", async () => {
    const run = makeRun(RunState.Todo);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry failed"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(200);
    await flush();
    expect(mockOrchestrator.retryRun).toHaveBeenCalled();
  });
});
