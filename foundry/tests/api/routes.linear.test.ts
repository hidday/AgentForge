import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(linearPollService?: Record<string, unknown>) {
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
    linearPollService as never,
  );
  await app.ready();

  return { app };
}

describe("GET /api/linear/pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp(undefined);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns the discovered issues on success", async () => {
    const issues = [{ id: "LIN-1", title: "Fix bug" }];
    const linearPollService = { discoverPendingIssues: vi.fn().mockResolvedValue(issues) };
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues });
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API unreachable")),
    };
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API unreachable" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns 400 when issueIds is missing", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Required: { issueIds: string[] }" });
    expect(linearPollService.startRunsForIssues).not.toHaveBeenCalled();
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is not an array", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: "LIN-1" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("starts runs for the given issue ids and returns ok:true merged with the result", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
    };
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("DB write failed")),
    };
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "DB write failed" });
  });
});
