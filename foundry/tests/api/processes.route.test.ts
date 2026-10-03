import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(processes: unknown[] = []) {
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
      { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "x", elapsedMs: 10 },
      { id: "p2", pid: 2, command: "codex", runId: "run-2", stage: "reviewer", runtime: "codex", startedAt: "y", elapsedMs: 20 },
    ];
    const { app } = await buildApp(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toHaveLength(2);
  });

  it("filters by runId querystring", async () => {
    const processes = [
      { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "x", elapsedMs: 10 },
      { id: "p2", pid: 2, command: "codex", runId: "run-2", stage: "reviewer", runtime: "codex", startedAt: "y", elapsedMs: 20 },
    ];
    const { app } = await buildApp(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { id: string; runId: string }[] };
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].id).toBe("p2");
  });

  it("returns an empty array when the runId filter matches nothing", async () => {
    const { app } = await buildApp([
      { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "x", elapsedMs: 10 },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=nonexistent" });

    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toEqual([]);
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the output buffer for a known process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some log output" });
  });

  it("returns 404 when the process output is unavailable", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("treats an empty string output as a valid (non-404) response", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "" });
  });
});
