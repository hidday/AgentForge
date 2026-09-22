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

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns discovered issues on success", async () => {
    const issues = [{ id: "issue-1" }, { id: "issue-2" }];
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue(issues),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp(linearPollService);

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ issues });
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API down")),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp(linearPollService);

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Linear API down" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no LinearPollService is configured", async () => {
    const { app } = await buildApp(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a"] },
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns 400 when issueIds is missing", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp(linearPollService);

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
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp(linearPollService);

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is not an array", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp(linearPollService);

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: "not-an-array" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("starts runs for the given issue ids and merges the result", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockResolvedValue({ started: 2, skipped: 1 }),
    };
    const { app } = await buildApp(linearPollService);

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a", "b"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, started: 2, skipped: 1 });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["a", "b"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("DB write failed")),
    };
    const { app } = await buildApp(linearPollService);

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a"] },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "DB write failed" });
  });
});
