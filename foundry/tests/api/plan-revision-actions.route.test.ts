import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(orchestratorOverrides: Record<string, unknown> = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
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
  return { app, mockOrchestrator };
}

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with ok and runId, and triggers runManualReReview with a sanitized note", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please double check the auth flow" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please double check the auth flow",
    });
  });

  it("returns 400 when runManualReReview throws synchronously", async () => {
    const { app } = await buildApp({
      runManualReReview: vi.fn(() => {
        throw new Error("cannot re-review in this state");
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot re-review in this state" });
  });

  it("returns 400 with a stringified message when a non-Error is thrown synchronously", async () => {
    const { app } = await buildApp({
      runManualReReview: vi.fn(() => {
        throw "boom";
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "boom" });
  });

  it("does not crash the request when the fire-and-forget promise rejects", async () => {
    const { app, mockOrchestrator } = await buildApp({
      runManualReReview: vi.fn().mockRejectedValue(new Error("background failure")),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with ok and runId, and triggers runManualPlanRevision with a sanitized note", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tighten up step 3" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "tighten up step 3",
    });
  });

  it("returns 400 when runManualPlanRevision throws synchronously", async () => {
    const { app } = await buildApp({
      runManualPlanRevision: vi.fn(() => {
        throw new Error("cannot revise in this state");
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot revise in this state" });
  });

  it("does not crash the request when the fire-and-forget promise rejects", async () => {
    const { app, mockOrchestrator } = await buildApp({
      runManualPlanRevision: vi.fn().mockRejectedValue(new Error("background failure")),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalled();
  });
});
