import { describe, it, expect, vi } from "vitest";
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
    rejectPlan: vi.fn(),
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
  return { app, mockOrchestrator };
}

describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
  it("returns 400 when mode is not 'iterate' or 'fresh'", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus-mode" },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("mode must be one of");
  });

  it("accepts mode='fresh' and passes it through", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue({ state: "Planning" });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: "redo it", mode: "fresh" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", "redo it", "api", "fresh");
  });

  it("treats a null body the same as no body (falls through to defaults)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue({ state: "Planning" });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: "null",
      headers: { "content-type": "application/json" },
    });

    // body === null is treated the same as "no body" — falls through to
    // defaults rather than entering the "context" in body branch.
    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "iterate");
  });
});
