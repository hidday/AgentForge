import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

function makeActiveProcess(overrides: Record<string, unknown> = {}) {
  return {
    id: "proc-1",
    pid: 1234,
    command: "claude plan",
    runId: "run-1",
    stage: "planning",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 500,
    ...overrides,
  };
}

async function buildApp(opts: { linearPollService?: Record<string, unknown> | undefined } = {}) {
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
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    opts.linearPollService as never,
  );

  await app.ready();
  return { app, mockProcessRunner };
}

describe("GET /api/processes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all active processes when no runId filter is given", async () => {
    const processes = [makeActiveProcess(), makeActiveProcess({ id: "proc-2", runId: "run-2" })];
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const response = await app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { processes: unknown[] };
    expect(body.processes).toHaveLength(2);
  });

  it("filters active processes by runId when provided", async () => {
    const processes = [makeActiveProcess(), makeActiveProcess({ id: "proc-2", runId: "run-2" })];
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { processes: { id: string; runId: string }[] };
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].id).toBe("proc-2");
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the process has no recorded output", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const response = await app.inject({ method: "GET", url: "/api/processes/unknown/output" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns { processId, output } with status 200 when output exists", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const response = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processId: "proc-1", output: "some log output" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(501);
    const body = response.json() as { error: string };
    expect(body.error).toContain("Linear polling not available");
  });

  it("returns { issues } with status 200 on success", async () => {
    const issues = [{ id: "LIN-1", title: "Fix bug" }];
    const linearPollService = { discoverPendingIssues: vi.fn().mockResolvedValue(issues) };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ issues });
  });

  it("returns 500 with the error message when discoverPendingIssues rejects", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API down")),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Linear API down" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(501);
    const body = response.json() as { error: string };
    expect(body.error).toContain("Linear polling not available");
  });

  it("returns 400 when issueIds is missing", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Required: { issueIds: string[] }" });
    expect(linearPollService.startRunsForIssues).not.toHaveBeenCalled();
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns { ok: true, ...result } with status 200 on success", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 with the error message when startRunsForIssues rejects", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("DB write failed")),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "DB write failed" });
  });
});
