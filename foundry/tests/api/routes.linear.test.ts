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

  it("returns 501 when no LinearPollService is configured", async () => {
    const { app } = await buildApp(undefined);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns { issues } on success", async () => {
    const discoverPendingIssues = vi.fn().mockResolvedValue([{ id: "iss-1" }, { id: "iss-2" }]);
    const { app } = await buildApp({ discoverPendingIssues });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "iss-1" }, { id: "iss-2" }] });
  });

  it("returns 500 with the error message when discoverPendingIssues throws", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue(new Error("Linear API unreachable"));
    const { app } = await buildApp({ discoverPendingIssues });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API unreachable" });
  });

  it("returns 500 with a stringified error when a non-Error value is thrown", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue("network down");
    const { app } = await buildApp({ discoverPendingIssues });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "network down" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no LinearPollService is configured", async () => {
    const { app } = await buildApp(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1"] },
    });

    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns 400 when issueIds is missing", async () => {
    const { app } = await buildApp({ startRunsForIssues: vi.fn() });

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Required: { issueIds: string[] }" });
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const { app } = await buildApp({ startRunsForIssues: vi.fn() });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is not an array", async () => {
    const { app } = await buildApp({ startRunsForIssues: vi.fn() });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: "iss-1" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns ok + result on success", async () => {
    const startRunsForIssues = vi
      .fn()
      .mockResolvedValue({ started: ["iss-1"], skipped: ["iss-2"] });
    const { app } = await buildApp({ startRunsForIssues });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1", "iss-2"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["iss-1"], skipped: ["iss-2"] });
    expect(startRunsForIssues).toHaveBeenCalledWith(["iss-1", "iss-2"]);
  });

  it("returns 500 with the error message when startRunsForIssues throws", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue(new Error("DB write failed"));
    const { app } = await buildApp({ startRunsForIssues });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "DB write failed" });
  });

  it("returns 500 with a stringified error when a non-Error value is thrown", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue("db down");
    const { app } = await buildApp({ startRunsForIssues });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "db down" });
  });
});
