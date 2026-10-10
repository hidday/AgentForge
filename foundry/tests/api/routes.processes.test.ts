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
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockProcessRunner };
}

describe("GET /api/processes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", pid: 1, command: "node", runId: "run-a", stage: "planning", runtime: "claude-code", startedAt: "t", elapsedMs: 1 },
      { id: "p2", pid: 2, command: "node", runId: "run-b", stage: "implementing", runtime: "codex", startedAt: "t", elapsedMs: 2 },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { id: string }[] };
    expect(body.processes).toHaveLength(2);
  });

  it("filters active processes by runId when ?runId= is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", pid: 1, command: "node", runId: "run-a", stage: "planning", runtime: "claude-code", startedAt: "t", elapsedMs: 1 },
      { id: "p2", pid: 2, command: "node", runId: "run-b", stage: "implementing", runtime: "codex", startedAt: "t", elapsedMs: 2 },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-b" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { id: string; runId: string }[] };
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].id).toBe("p2");
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when no output is available for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/unknown/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns 200 with the process output when available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some log output" });
  });
});
