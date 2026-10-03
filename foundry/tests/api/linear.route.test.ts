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
    expect(res.json().error).toContain("LINEAR_API_KEY");
  });

  it("returns the discovered pending issues", async () => {
    const discoverPendingIssues = vi.fn().mockResolvedValue([{ id: "LIN-1" }, { id: "LIN-2" }]);
    const { app } = await buildApp({ discoverPendingIssues });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json().issues).toEqual([{ id: "LIN-1" }, { id: "LIN-2" }]);
    expect(discoverPendingIssues).toHaveBeenCalledOnce();
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
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
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(501);
    expect(res.json().error).toContain("LINEAR_API_KEY");
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const startRunsForIssues = vi.fn();
    const { app } = await buildApp({ startRunsForIssues });

    const resMissing = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
    expect(resMissing.statusCode).toBe(400);

    const resEmpty = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });
    expect(resEmpty.statusCode).toBe(400);
    expect(startRunsForIssues).not.toHaveBeenCalled();
  });

  it("starts runs for the given issue ids and returns the result", async () => {
    const startRunsForIssues = vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] });
    const { app } = await buildApp({ startRunsForIssues });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue(new Error("DB write failed"));
    const { app } = await buildApp({ startRunsForIssues });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "DB write failed" });
  });
});
