import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

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

  return { app };
}

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no LinearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns { issues } on success", async () => {
    const issues = [{ id: "LIN-1", title: "Fix bug" }];
    const linearPollService = { discoverPendingIssues: vi.fn().mockResolvedValue(issues) };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues });
  });

  it("returns 500 with the error message when discoverPendingIssues() throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API unavailable")),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API unavailable" });
  });

  it("stringifies a non-Error value rejected by discoverPendingIssues", async () => {
    const linearPollService = {
      // eslint-disable-next-line prefer-promise-reject-errors
      discoverPendingIssues: vi.fn().mockRejectedValue("plain string failure"),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no LinearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Required: { issueIds: string[] }" });
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is not an array", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: "LIN-1" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns { ok: true, ...result } on success", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 with the error message when startRunsForIssues() throws", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("Failed to create run")),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Failed to create run" });
  });

  it("stringifies a non-Error value rejected by startRunsForIssues", async () => {
    const linearPollService = {
      // eslint-disable-next-line prefer-promise-reject-errors
      startRunsForIssues: vi.fn().mockRejectedValue("plain string failure"),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});
