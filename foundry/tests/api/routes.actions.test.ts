import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
    linearIssueUrl: null,
    repo: "test/repo",
    branchName: "main",
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
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
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockOrchestrator, mockRunRepo };
}

// Wait a tick so fire-and-forget promise chains (e.g. `.catch(...)`) settle
// before assertions run.
async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with the new state and triggers execution", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "  Looks solid  " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "Looks solid" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "Looks solid" });
  });

  it("sanitizes an empty/whitespace note to undefined", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });

  it("returns 400 when approvePlan throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Plan not found"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Plan not found" });
    expect(mockOrchestrator.runExecution).not.toHaveBeenCalled();
  });

  it("does not fail the request when the background runExecution rejects", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("Execution boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
    expect(mockOrchestrator.runExecution).toHaveBeenCalled();
  });

  it("logs but does not fail the request when background runExecution rejects with a non-Error", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue({ code: "EXEC_FAIL" });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
    expect(mockOrchestrator.runExecution).toHaveBeenCalled();
  });

  it("stringifies a non-Error rejection from approvePlan", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue("plain-string-rejection");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain-string-rejection" });
  });
});

describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when mode is not one of the valid values", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: "Needs rework", mode: "bogus" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
    expect(mockOrchestrator.rejectPlan).not.toHaveBeenCalled();
  });

  it("accepts mode: fresh and passes it through to rejectPlan", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: "Start over", mode: "fresh" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", "Start over", "api", "fresh");
  });

  it("stringifies a non-Error rejection from rejectPlan", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockRejectedValue({ code: "boom" });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: String({ code: "boom" }) });
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 immediately and fires runManualReReview with sanitized note", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: " please recheck " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please recheck",
    });
  });

  it("does not fail the request when the background call rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("re-review boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalled();
  });

  it("does not fail the request when the background call rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue("re-review boom (string)");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalled();
  });

  it("returns 400 if constructing the request throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("synchronous failure");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "synchronous failure" });
  });

  it("returns 400 with a stringified error if the synchronous throw is not an Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw "non-error synchronous failure";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "non-error synchronous failure" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 immediately and fires runManualPlanRevision with sanitized note", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "Use OAuth2" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "Use OAuth2",
    });
  });

  it("does not fail the request when the background call rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("revise boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalled();
  });

  it("does not fail the request when the background call rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue("revise boom (string)");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalled();
  });

  it("returns 400 if constructing the request throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("synchronous failure");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "synchronous failure" });
  });

  it("returns 400 with a stringified error if the synchronous throw is not an Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw "non-error synchronous failure";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "non-error synchronous failure" });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with the new state on success", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 when approveHumanReview throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("Wrong state"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Wrong state" });
  });

  it("stringifies a non-Error rejection from approveHumanReview", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(42);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "42" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("calls handleCommand with pause-ai and returns ok", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Cannot pause"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Cannot pause" });
  });

  it("stringifies a non-Error rejection from handleCommand", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue({ reason: "denied" });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: String({ reason: "denied" }) });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("calls handleCommand with resume-ai and returns ok", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Cannot resume"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Cannot resume" });
  });

  it("stringifies a non-Error rejection from handleCommand", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue({ reason: "denied" });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: String({ reason: "denied" }) });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns 400 for a non-retryable state (e.g. Done)", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain("Retryable states:");
  });

  const cases: { state: RunState; method: string }[] = [
    { state: RunState.Todo, method: "retryRun" },
    { state: RunState.Planning, method: "runPlanning" },
    { state: RunState.PlanRevision, method: "runPlanRevision" },
    { state: RunState.PlanReview, method: "runPlanReview" },
    { state: RunState.Implementing, method: "runExecution" },
    { state: RunState.AIReview, method: "runReview" },
    { state: RunState.AddressingReview, method: "runRemediation" },
  ];

  for (const { state, method } of cases) {
    it(`triggers orchestrator.${method}() for state ${state} and returns retrying:true`, async () => {
      const run = makeRun({ state });
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      (mockOrchestrator[method as keyof typeof mockOrchestrator] as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(mockOrchestrator[method as keyof typeof mockOrchestrator]).toHaveBeenCalledWith("run-1");
    });
  }

  it("does not fail the request when the background retry trigger rejects", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry boom"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
    expect(mockOrchestrator.retryRun).toHaveBeenCalledWith("run-1");
  });

  it("does not fail the request when the background retry trigger rejects with a non-Error", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue("retry boom (string)");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
    expect(mockOrchestrator.retryRun).toHaveBeenCalledWith("run-1");
  });
});
