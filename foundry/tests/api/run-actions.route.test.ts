import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(state: RunState = RunState.AwaitingPlanApproval) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: "Add login",
    linearIssueUrl: null,
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
  };
}

async function buildApp(orchestratorOverrides: Record<string, unknown> = {}) {
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
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    ...orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo };
}

// Let any fire-and-forget promises started by a route handler settle.
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves the plan, kicks off execution, and returns the new state", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "  looks good  " },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("logs but does not reject the response when runExecution fails asynchronously", async () => {
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
  });

  it("returns 400 when approvePlan throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Cannot approve in this state"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cannot approve in this state" });
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("kicks off a manual re-review and returns ok", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "re-check this" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "re-check this",
    });
  });

  it("does not fail the response when runManualReReview rejects asynchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("async failure"));

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
      throw new Error("sync failure");
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "sync failure" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("kicks off a manual plan revision and returns ok", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "revise it" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "revise it",
    });
  });

  it("does not fail the response when runManualPlanRevision rejects asynchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("async failure"));

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
      throw new Error("sync failure");
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "sync failure" });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves the human review and returns the new state", async () => {
    const run = makeRun(RunState.Done);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, state: RunState.Done });
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 when approveHumanReview throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("Not ready for review"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Not ready for review" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/pause",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("sends a pause-ai command and returns ok", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/pause",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
      type: "pause-ai",
    });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Cannot pause"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/pause",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cannot pause" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/resume",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("sends a resume-ai command and returns ok", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/resume",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
      type: "resume-ai",
    });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Cannot resume"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/resume",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cannot resume" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/retry",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns 400 for a state that is not retryable", async () => {
    const run = makeRun(RunState.Done);
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/retry",
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain("Retryable states:");
  });

  const retryableCases: { state: RunState; orchestratorMethod: string }[] = [
    { state: RunState.Todo, orchestratorMethod: "retryRun" },
    { state: RunState.Planning, orchestratorMethod: "runPlanning" },
    { state: RunState.PlanRevision, orchestratorMethod: "runPlanRevision" },
    { state: RunState.PlanReview, orchestratorMethod: "runPlanReview" },
    { state: RunState.Implementing, orchestratorMethod: "runExecution" },
    { state: RunState.AIReview, orchestratorMethod: "runReview" },
    { state: RunState.AddressingReview, orchestratorMethod: "runRemediation" },
  ];

  for (const { state, orchestratorMethod } of retryableCases) {
    it(`triggers ${orchestratorMethod} and returns retrying=true for state ${state}`, async () => {
      const run = makeRun(state);
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      (mockOrchestrator[orchestratorMethod as keyof typeof mockOrchestrator] as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );

      const response = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/retry",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        runId: "run-1",
        state,
        retrying: true,
      });
      expect(mockOrchestrator[orchestratorMethod as keyof typeof mockOrchestrator]).toHaveBeenCalledWith(
        "run-1",
      );
      await flush();
    });
  }

  it("logs but does not crash when the fire-and-forget retry trigger rejects", async () => {
    const run = makeRun(RunState.Todo);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry failed"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/retry",
    });

    expect(response.statusCode).toBe(200);
    await flush();
  });
});

describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when mode is not one of the valid modes", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus-mode" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
    expect(mockOrchestrator.rejectPlan).not.toHaveBeenCalled();
  });

  it("passes mode='fresh' through to rejectPlan when explicitly provided", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "fresh");
  });
});
