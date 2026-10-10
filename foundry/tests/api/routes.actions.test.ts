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

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves the plan, kicks off execution in the background, and returns 200", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "looks good" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; state: string };
    expect(body.ok).toBe(true);
    expect(body.state).toBe(RunState.Implementing);
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("returns 400 when orchestrator.approvePlan throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Cannot approve in this state"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Cannot approve in this state" });
  });

  it("does not fail the request when the background runExecution rejects", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("background failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    // allow the fire-and-forget rejection handler (app.log.error) to run
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when mode is invalid", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus-mode" },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("mode must be one of");
  });

  it("passes mode='fresh' through to orchestrator.rejectPlan", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh", context: "start over" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", "start over", "api", "fresh");
  });

  it("defaults mode to 'iterate' when mode is omitted", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "iterate");
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("kicks off manual re-review in the background and returns 200 immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; runId: string };
    expect(body.ok).toBe(true);
    expect(body.runId).toBe("run-1");
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: "please re-check" });
  });

  it("logs but does not fail the request when the background call rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("kicks off manual plan revision in the background and returns 200 immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "revise it" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; runId: string };
    expect(body.ok).toBe(true);
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", { note: "revise it" });
  });

  it("logs but does not fail the request when the background call rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves the human review and returns the new state", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when orchestrator throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("not ready"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "not ready" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with pause-ai and returns ok", async () => {
    const run = makeRun({ linearIssueId: "LIN-7" });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-7", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot pause" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with resume-ai and returns ok", async () => {
    const run = makeRun({ linearIssueId: "LIN-8" });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-8", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot resume" });
  });
});
