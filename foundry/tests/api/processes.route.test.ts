import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

function makeProcess(overrides: Record<string, unknown> = {}) {
  return {
    id: "proc-1",
    pid: 1234,
    command: "npm test",
    runId: "run-1",
    stage: "implement",
    runtime: "node",
    startedAt: new Date().toISOString(),
    elapsedMs: 500,
    ...overrides,
  };
}

async function buildApp() {
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

  it("returns all active processes when no runId query param is given", async () => {
    const procs = [makeProcess(), makeProcess({ id: "proc-2", runId: "run-2" })];
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue(procs);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: unknown[] };
    expect(body.processes).toHaveLength(2);
  });

  it("filters processes by runId query param", async () => {
    const procs = [makeProcess({ id: "proc-1", runId: "run-1" }), makeProcess({ id: "proc-2", runId: "run-2" })];
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue(procs);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { id: string; runId: string }[] };
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].id).toBe("proc-2");
  });

  it("returns an empty array when runId matches nothing", async () => {
    const procs = [makeProcess({ runId: "run-1" })];
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue(procs);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=no-such-run" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes: [] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when there is no output for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/unknown/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns processId and output when found", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "some log output" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("treats an empty-string output as found (not 404)", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("");

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "" });
  });
});
