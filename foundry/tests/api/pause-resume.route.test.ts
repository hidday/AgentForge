import { describe, it, expect, vi } from "vitest";
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
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn(), create: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    handleCommand: vi.fn().mockResolvedValue(undefined),
    approvePlan: vi.fn(),
    runExecution: vi.fn().mockResolvedValue(undefined),
    rejectPlan: vi.fn(),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    approveHumanReview: vi.fn(),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();
  return { app, mockRunRepo, mockOrchestrator };
}

describe("POST /api/runs/:id/actions/pause", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns 200 and issues a pause-ai command on success", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ linearIssueId: "LIN-9" }));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-9", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "cannot pause" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns 200 and issues a resume-ai command on success", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ linearIssueId: "LIN-9" }));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-9", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "cannot resume" });
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("returns 200, approves the plan, and fires runExecution in the background", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "looks good" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("returns 400 when approvePlan throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("plan already approved"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "plan already approved" });
    expect(mockOrchestrator.runExecution).not.toHaveBeenCalled();
  });

  it("logs but does not throw when the fire-and-forgotten runExecution rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockRejectedValue(new Error("execution boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockOrchestrator.runExecution).toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("returns 200 and fires runManualReReview in the background", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please recheck" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please recheck",
    });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("returns 200 and fires runManualPlanRevision in the background", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "revise please" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "revise please",
    });
  });

  it("returns 400 when sanitizeNote/synchronous handling throws", async () => {
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
  it("returns 200 with the resulting state on success", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(makeRun({ state: RunState.Done }));

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
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("not ready for review"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "not ready for review" });
  });
});
