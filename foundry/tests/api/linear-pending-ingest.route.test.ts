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

  it("returns the discovered issues on success", async () => {
    const issues = [{ id: "iss-1", title: "Fix bug" }];
    const discoverPendingIssues = vi.fn().mockResolvedValue(issues);
    const { app } = await buildApp({ discoverPendingIssues });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues });
  });

  it("returns 500 when discovery throws", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue(new Error("Linear API down"));
    const { app } = await buildApp({ discoverPendingIssues });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API down" });
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
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const startRunsForIssues = vi.fn();
    const { app } = await buildApp({ startRunsForIssues });

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Required: { issueIds: string[] }" });
    expect(startRunsForIssues).not.toHaveBeenCalled();
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const startRunsForIssues = vi.fn();
    const { app } = await buildApp({ startRunsForIssues });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns ok with started/skipped on success", async () => {
    const startRunsForIssues = vi.fn().mockResolvedValue({ started: ["iss-1"], skipped: ["iss-2"] });
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

  it("returns 500 when startRunsForIssues throws", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue(new Error("db unavailable"));
    const { app } = await buildApp({ startRunsForIssues });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "db unavailable" });
  });
});
