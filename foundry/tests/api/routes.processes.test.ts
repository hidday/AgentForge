import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp() {
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

  it("returns all active processes when no runId querystring is given", async () => {
    const processes = [
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ];
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes });
  });

  it("filters active processes by runId when provided", async () => {
    const processes = [
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ];
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes: [{ id: "p2", runId: "run-2" }] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when there is no output for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns { processId, output } when output is available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("stdout chunk");

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "stdout chunk" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("treats an empty-string output as present (not 404)", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("");

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-2/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-2", output: "" });
  });
});
