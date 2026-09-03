import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(opts: { withLinearPollService?: boolean } = {}) {
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

  const mockLinearPollService =
    opts.withLinearPollService === false
      ? undefined
      : {
          discoverPendingIssues: vi.fn().mockResolvedValue([]),
          startRunsForIssues: vi.fn().mockResolvedValue({ started: [], skipped: [] }),
        };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    mockLinearPollService as never,
  );

  await app.ready();
  return { app, mockLinearPollService };
}

describe("GET /api/linear/pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPollService: false });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns discovered pending issues", async () => {
    const issues = [{ id: "LIN-1", title: "Issue one" }];
    const { app, mockLinearPollService } = await buildApp();
    mockLinearPollService!.discoverPendingIssues.mockResolvedValue(issues);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues });
  });

  it("returns 500 when discoverPendingIssues rejects", async () => {
    const { app, mockLinearPollService } = await buildApp();
    mockLinearPollService!.discoverPendingIssues.mockRejectedValue(new Error("Linear API down"));

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
    const { app } = await buildApp({ withLinearPollService: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Required: { issueIds: string[] }" });
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is not an array", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: "LIN-1" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("starts runs for the given issue ids and returns the result merged with ok:true", async () => {
    const { app, mockLinearPollService } = await buildApp();
    mockLinearPollService!.startRunsForIssues.mockResolvedValue({
      started: ["LIN-1"],
      skipped: ["LIN-2"],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1", "LIN-2"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: ["LIN-2"] });
    expect(mockLinearPollService!.startRunsForIssues).toHaveBeenCalledWith(["LIN-1", "LIN-2"]);
  });

  it("returns 500 when startRunsForIssues rejects", async () => {
    const { app, mockLinearPollService } = await buildApp();
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
