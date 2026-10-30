import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(opts: { withLinearPoll?: boolean } = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockLinearPollService = opts.withLinearPoll
    ? {
        discoverPendingIssues: vi.fn(),
        startRunsForIssues: vi.fn(),
      }
    : undefined;

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    mockLinearPollService as never,
  );

  await app.ready();
  return { app, mockProcessRunner, mockLinearPollService, mockEmitter };
}

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      processes: [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }],
    });
  });

  it("filters processes by runId querystring", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.json()).toEqual({ processes: [{ id: "p2", runId: "run-2" }] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when there is no output for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
  });

  it("returns { processId, output } when available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some log output" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp({ withLinearPoll: false });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
  });

  it("returns { issues } on success", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPoll: true });
    mockLinearPollService!.discoverPendingIssues.mockResolvedValue([{ id: "LIN-1" }]);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "LIN-1" }] });
  });

  it("returns 500 with the error message when discoverPendingIssues throws", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPoll: true });
    mockLinearPollService!.discoverPendingIssues.mockRejectedValue(new Error("Linear down"));

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear down" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp({ withLinearPoll: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const { app } = await buildApp({ withLinearPoll: true });

    const res1 = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
    expect(res1.statusCode).toBe(400);

    const res2 = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });
    expect(res2.statusCode).toBe(400);
  });

  it("returns { ok: true, ...result } on success", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPoll: true });
    mockLinearPollService!.startRunsForIssues.mockResolvedValue({ started: ["LIN-1"], skipped: [] });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(mockLinearPollService!.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 with the error message when startRunsForIssues throws", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPoll: true });
    mockLinearPollService!.startRunsForIssues.mockRejectedValue(new Error("ingest failed"));

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ingest failed" });
  });
});

describe("GET /api/events/stream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes the SSE headers, registers a dashboard listener, and cleans up on close", async () => {
    vi.useFakeTimers();
    const { app, mockEmitter } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/events/stream" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

    // app.inject() simulates the request lifecycle, including the 'close'
    // event on the raw request/response, so cleanup should already have run.
    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", expect.any(Function));
    vi.useRealTimers();
  });
});
