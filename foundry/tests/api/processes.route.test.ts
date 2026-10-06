import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(processes: { id: string; runId: string }[] = []) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue(processes),
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
  return { app, mockProcessRunner };
}

describe("GET /api/processes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all active processes when no runId filter is given", async () => {
    const processes = [
      { id: "p1", runId: "run-a" },
      { id: "p2", runId: "run-b" },
    ];
    const { app } = await buildApp(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes });
  });

  it("filters processes by runId when provided", async () => {
    const processes = [
      { id: "p1", runId: "run-a" },
      { id: "p2", runId: "run-b" },
      { id: "p3", runId: "run-a" },
    ];
    const { app } = await buildApp(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-a" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      processes: [
        { id: "p1", runId: "run-a" },
        { id: "p3", runId: "run-a" },
      ],
    });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when no output is available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns the process output when available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some stdout content");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some stdout content" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("p1");
  });
});
