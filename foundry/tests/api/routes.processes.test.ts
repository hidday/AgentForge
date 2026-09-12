import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(overrides: {
  activeProcesses?: unknown[];
  processOutput?: string | null;
} = {}) {
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
    getActiveProcesses: vi.fn().mockReturnValue(overrides.activeProcesses ?? []),
    getProcessOutput: vi.fn().mockReturnValue(overrides.processOutput ?? null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockProcessRunner };
}

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId filter is given", async () => {
    const processes = [
      { id: "p1", runId: "run-1", stage: "planning" },
      { id: "p2", runId: "run-2", stage: "implementing" },
    ];
    const { app } = await buildApp({ activeProcesses: processes });

    const response = await app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processes });
  });

  it("filters processes by runId when provided", async () => {
    const processes = [
      { id: "p1", runId: "run-1", stage: "planning" },
      { id: "p2", runId: "run-2", stage: "implementing" },
    ];
    const { app } = await buildApp({ activeProcesses: processes });

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processes: [processes[1]] });
  });

  it("returns an empty array when runId matches nothing", async () => {
    const { app } = await buildApp({ activeProcesses: [{ id: "p1", runId: "run-1" }] });

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=nope" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processes: [] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the process has no recorded output", async () => {
    const { app } = await buildApp({ processOutput: null });

    const response = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns the processId and output when available", async () => {
    const { app, mockProcessRunner } = await buildApp({ processOutput: "line1\nline2\n" });

    const response = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processId: "proc-1", output: "line1\nline2\n" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("returns 200 with empty-string output (distinct from the 404 no-output case)", async () => {
    const { app } = await buildApp({ processOutput: "" });

    const response = await app.inject({ method: "GET", url: "/api/processes/proc-2/output" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processId: "proc-2", output: "" });
  });
});
