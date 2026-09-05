import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(opts: {
  processes?: { runId: string; id: string }[];
  processOutput?: string | null;
  linearPollService?: Record<string, unknown>;
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
    getActiveProcesses: vi.fn().mockReturnValue(opts.processes ?? []),
    getProcessOutput: vi.fn().mockReturnValue(opts.processOutput ?? null),
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

  it("returns all active processes when no runId filter given", async () => {
    const processes = [
      { runId: "run-1", id: "p1" },
      { runId: "run-2", id: "p2" },
    ];
    const { app } = await buildApp({ processes });

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: unknown[] };
    expect(body.processes).toHaveLength(2);
  });

  it("filters processes by runId when provided", async () => {
    const processes = [
      { runId: "run-1", id: "p1" },
      { runId: "run-2", id: "p2" },
    ];
    const { app } = await buildApp({ processes });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { id: string }[] };
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].id).toBe("p2");
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the process is not found", async () => {
    const { app } = await buildApp({ processOutput: null });

    const res = await app.inject({ method: "GET", url: "/api/processes/unknown/output" });

    expect(res.statusCode).toBe(404);
  });

  it("returns the process output when found", async () => {
    const { app } = await buildApp({ processOutput: "hello world" });

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "hello world" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
  });

  it("returns discovered issues when configured", async () => {
    const discoverPendingIssues = vi.fn().mockResolvedValue([{ id: "iss-1" }]);
    const { app } = await buildApp({ linearPollService: { discoverPendingIssues } });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "iss-1" }] });
  });

  it("returns 500 when discovery throws", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue(new Error("Linear API down"));
    const { app } = await buildApp({ linearPollService: { discoverPendingIssues } });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API down" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const startRunsForIssues = vi.fn();
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(startRunsForIssues).not.toHaveBeenCalled();
  });

  it("starts runs for the given issue ids", async () => {
    const startRunsForIssues = vi.fn().mockResolvedValue({ started: ["a"], skipped: [] });
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["a"], skipped: [] });
    expect(startRunsForIssues).toHaveBeenCalledWith(["a"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue(new Error("db error"));
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "db error" });
  });
});
