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
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId query param is given", async () => {
    const processes = [
      { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "t", elapsedMs: 5 },
      { id: "p2", pid: 2, command: "codex", runId: "run-2", stage: "reviewer", runtime: "codex", startedAt: "t", elapsedMs: 5 },
    ];
    const { app, mockProcessRunner } = await buildApp({
      getActiveProcesses: vi.fn().mockReturnValue(processes),
    });

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes });
    expect(mockProcessRunner.getActiveProcesses).toHaveBeenCalledOnce();
  });

  it("filters active processes by the runId query param", async () => {
    const processes = [
      { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "t", elapsedMs: 5 },
      { id: "p2", pid: 2, command: "codex", runId: "run-2", stage: "reviewer", runtime: "codex", startedAt: "t", elapsedMs: 5 },
    ];
    const { app } = await buildApp({ getActiveProcesses: vi.fn().mockReturnValue(processes) });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { runId: string }[] };
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0]!.runId).toBe("run-2");
  });

  it("returns an empty list when the runId filter matches nothing", async () => {
    const { app } = await buildApp({
      getActiveProcesses: vi.fn().mockReturnValue([
        { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "t", elapsedMs: 5 },
      ]),
    });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=nonexistent" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes: [] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the process is not found (output is null)", async () => {
    const { app } = await buildApp({ getProcessOutput: vi.fn().mockReturnValue(null) });

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns { processId, output } when output is available", async () => {
    const { app, mockProcessRunner } = await buildApp({
      getProcessOutput: vi.fn().mockReturnValue("some log output"),
    });

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "some log output" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("returns 200 with an empty-string output (distinct from null/not-found)", async () => {
    const { app } = await buildApp({ getProcessOutput: vi.fn().mockReturnValue("") });

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-2/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-2", output: "" });
  });
});
