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

describe("POST /api/runs/:id/actions/reject-plan -- non-Error rejection", () => {
  it("returns 400 with a stringified message when rejectPlan rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    // eslint-disable-next-line prefer-promise-reject-errors
    mockOrchestrator.rejectPlan.mockRejectedValue("plain reject-plan failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: "feedback" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain reject-plan failure" });
  });
});
