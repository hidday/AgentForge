import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn(), create: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();
  return { app, mockProcessRunner };
}

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    const processes = [
      { id: "p1", runId: "run-1", stage: "planning" },
      { id: "p2", runId: "run-2", stage: "implementing" },
    ];
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const response = await app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { processes: unknown[] };
    expect(body.processes).toEqual(processes);
  });

  it("filters processes by runId when ?runId= is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    const processes = [
      { id: "p1", runId: "run-1", stage: "planning" },
      { id: "p2", runId: "run-2", stage: "implementing" },
    ];
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { processes: { runId: string }[] };
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].runId).toBe("run-2");
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns 404 when the process output is not found", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const response = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns the output for an existing process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const response = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(response.statusCode).toBe(200);
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("p1");
    expect(response.json()).toEqual({ processId: "p1", output: "some log output" });
  });
});
