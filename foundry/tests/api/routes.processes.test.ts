import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(processRunnerOverrides: Record<string, unknown> = {}) {
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
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
    ...processRunnerOverrides,
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockProcessRunner };
}

describe("GET /api/processes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all active processes when no runId filter is given", async () => {
    const processes = [
      { id: "p1", runId: "run-1", stage: "planning" },
      { id: "p2", runId: "run-2", stage: "execution" },
    ];
    const { app } = await buildApp({ getActiveProcesses: vi.fn().mockReturnValue(processes) });

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes });
  });

  it("filters processes by the runId querystring", async () => {
    const processes = [
      { id: "p1", runId: "run-1", stage: "planning" },
      { id: "p2", runId: "run-2", stage: "execution" },
    ];
    const { app } = await buildApp({ getActiveProcesses: vi.fn().mockReturnValue(processes) });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes: [{ id: "p2", runId: "run-2", stage: "execution" }] });
  });

  it("returns an empty list when the runId filter matches nothing", async () => {
    const processes = [{ id: "p1", runId: "run-1", stage: "planning" }];
    const { app } = await buildApp({ getActiveProcesses: vi.fn().mockReturnValue(processes) });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=no-match" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes: [] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when there is no output for the process id", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns the process id and output on success", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some stdout chunk");

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "some stdout chunk" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("treats an empty string output as a valid (non-404) response", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("");

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-2/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-2", output: "" });
  });
});
