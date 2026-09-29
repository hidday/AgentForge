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
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
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
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ];
    const { app } = await buildApp({ getActiveProcesses: vi.fn().mockReturnValue(processes) });

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes });
  });

  it("filters processes by runId querystring", async () => {
    const processes = [
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ];
    const { app } = await buildApp({ getActiveProcesses: vi.fn().mockReturnValue(processes) });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes: [{ id: "p2", runId: "run-2" }] });
  });

  it("returns an empty list when the runId filter matches nothing", async () => {
    const { app } = await buildApp({
      getActiveProcesses: vi.fn().mockReturnValue([{ id: "p1", runId: "run-1" }]),
    });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=unknown" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes: [] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the process has no recorded output", async () => {
    const { app } = await buildApp({ getProcessOutput: vi.fn().mockReturnValue(null) });

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns the process output when available", async () => {
    const { app, mockProcessRunner } = await buildApp({
      getProcessOutput: vi.fn().mockReturnValue("line1\nline2\n"),
    });

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "line1\nline2\n" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("treats an empty string output as available (not 404)", async () => {
    const { app } = await buildApp({ getProcessOutput: vi.fn().mockReturnValue("") });

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-2/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-2", output: "" });
  });
});
