import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(overrides: {
  withLinearPollService?: boolean;
  discoverPendingIssuesImpl?: () => Promise<unknown[]>;
  startRunsForIssuesImpl?: () => Promise<Record<string, unknown>>;
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
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockLinearPollService = overrides.withLinearPollService === false
    ? undefined
    : {
        discoverPendingIssues: vi.fn(overrides.discoverPendingIssuesImpl ?? (async () => [])),
        startRunsForIssues: vi.fn(overrides.startRunsForIssuesImpl ?? (async () => ({ started: [] }))),
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
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPollService: false });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns the discovered issues on success", async () => {
    const issues = [{ id: "LIN-1", title: "Fix bug" }];
    const { app } = await buildApp({ discoverPendingIssuesImpl: async () => issues });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ issues });
  });

  it("returns 500 with the error message when discovery throws", async () => {
    const { app } = await buildApp({
      discoverPendingIssuesImpl: async () => {
        throw new Error("Linear API unreachable");
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Linear API unreachable" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPollService: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns 400 when issueIds is missing", async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Required: { issueIds: string[] }" });
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 200 merging the service result with ok:true", async () => {
    const { app, mockLinearPollService } = await buildApp({
      startRunsForIssuesImpl: async () => ({ started: ["run-1"], skipped: ["LIN-2"] }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1", "LIN-2"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, started: ["run-1"], skipped: ["LIN-2"] });
    expect(mockLinearPollService!.startRunsForIssues).toHaveBeenCalledWith(["LIN-1", "LIN-2"]);
  });

  it("returns 500 with the error message when the service throws", async () => {
    const { app } = await buildApp({
      startRunsForIssuesImpl: async () => {
        throw new Error("Failed to start runs");
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Failed to start runs" });
  });
});
