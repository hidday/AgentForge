import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

function buildMockOrchestrator() {
  return {
    getRunRepo: () => ({ findAll: vi.fn(), findById: vi.fn() }),
    getArtifactRepo: () => ({ findByRunId: vi.fn() }),
    getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
    getAgentSkillRepo: () => ({}),
  };
}

describe("process + linear polling routes", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  describe("GET /api/processes", () => {
    it("returns all active processes when no runId filter is given", async () => {
      const mockProcessRunner = {
        getActiveProcesses: vi.fn().mockReturnValue([
          { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "x", elapsedMs: 10 },
          { id: "p2", pid: 2, command: "codex", runId: "run-2", stage: "reviewer", runtime: "codex", startedAt: "x", elapsedMs: 5 },
        ]),
        getProcessOutput: vi.fn(),
      };
      app = Fastify({ logger: false });
      registerApiRoutes(app, buildMockOrchestrator() as never, { on: vi.fn(), off: vi.fn() } as never, mockProcessRunner as never);
      await app.ready();

      const response = await app.inject({ method: "GET", url: "/api/processes" });

      expect(response.statusCode).toBe(200);
      expect(response.json().processes).toHaveLength(2);
    });

    it("filters active processes by runId", async () => {
      const mockProcessRunner = {
        getActiveProcesses: vi.fn().mockReturnValue([
          { id: "p1", pid: 1, command: "claude", runId: "run-1", stage: "planner", runtime: "claude-code", startedAt: "x", elapsedMs: 10 },
          { id: "p2", pid: 2, command: "codex", runId: "run-2", stage: "reviewer", runtime: "codex", startedAt: "x", elapsedMs: 5 },
        ]),
        getProcessOutput: vi.fn(),
      };
      app = Fastify({ logger: false });
      registerApiRoutes(app, buildMockOrchestrator() as never, { on: vi.fn(), off: vi.fn() } as never, mockProcessRunner as never);
      await app.ready();

      const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

      const body = response.json().processes as { id: string }[];
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("p2");
    });
  });

  describe("GET /api/processes/:id/output", () => {
    it("returns 404 when no output is available", async () => {
      const mockProcessRunner = {
        getActiveProcesses: vi.fn(),
        getProcessOutput: vi.fn().mockReturnValue(null),
      };
      app = Fastify({ logger: false });
      registerApiRoutes(app, buildMockOrchestrator() as never, { on: vi.fn(), off: vi.fn() } as never, mockProcessRunner as never);
      await app.ready();

      const response = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

      expect(response.statusCode).toBe(404);
    });

    it("returns the buffered output when available", async () => {
      const mockProcessRunner = {
        getActiveProcesses: vi.fn(),
        getProcessOutput: vi.fn().mockReturnValue("some log output"),
      };
      app = Fastify({ logger: false });
      registerApiRoutes(app, buildMockOrchestrator() as never, { on: vi.fn(), off: vi.fn() } as never, mockProcessRunner as never);
      await app.ready();

      const response = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ processId: "p1", output: "some log output" });
    });
  });

  describe("GET /api/linear/pending", () => {
    it("returns 501 when no linearPollService is configured", async () => {
      app = Fastify({ logger: false });
      registerApiRoutes(
        app,
        buildMockOrchestrator() as never,
        { on: vi.fn(), off: vi.fn() } as never,
        { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
      );
      await app.ready();

      const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(response.statusCode).toBe(501);
    });

    it("returns discovered issues when the service succeeds", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-1" }]),
        startRunsForIssues: vi.fn(),
      };
      app = Fastify({ logger: false });
      registerApiRoutes(
        app,
        buildMockOrchestrator() as never,
        { on: vi.fn(), off: vi.fn() } as never,
        { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
        linearPollService as never,
      );
      await app.ready();

      const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ issues: [{ id: "LIN-1" }] });
    });

    it("returns 500 when the service throws", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear down")),
        startRunsForIssues: vi.fn(),
      };
      app = Fastify({ logger: false });
      registerApiRoutes(
        app,
        buildMockOrchestrator() as never,
        { on: vi.fn(), off: vi.fn() } as never,
        { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
        linearPollService as never,
      );
      await app.ready();

      const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "linear down" });
    });
  });

  describe("POST /api/linear/ingest", () => {
    it("returns 501 when no linearPollService is configured", async () => {
      app = Fastify({ logger: false });
      registerApiRoutes(
        app,
        buildMockOrchestrator() as never,
        { on: vi.fn(), off: vi.fn() } as never,
        { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
      );
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(response.statusCode).toBe(501);
    });

    it("returns 400 when issueIds is missing or empty", async () => {
      const linearPollService = { discoverPendingIssues: vi.fn(), startRunsForIssues: vi.fn() };
      app = Fastify({ logger: false });
      registerApiRoutes(
        app,
        buildMockOrchestrator() as never,
        { on: vi.fn(), off: vi.fn() } as never,
        { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
        linearPollService as never,
      );
      await app.ready();

      const emptyArray = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: [] },
      });
      expect(emptyArray.statusCode).toBe(400);

      const missing = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
      expect(missing.statusCode).toBe(400);
    });

    it("starts runs for the given issue ids", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn(),
        startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
      };
      app = Fastify({ logger: false });
      registerApiRoutes(
        app,
        buildMockOrchestrator() as never,
        { on: vi.fn(), off: vi.fn() } as never,
        { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
        linearPollService as never,
      );
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
      expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
    });

    it("returns 500 when startRunsForIssues throws", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn(),
        startRunsForIssues: vi.fn().mockRejectedValue(new Error("boom")),
      };
      app = Fastify({ logger: false });
      registerApiRoutes(
        app,
        buildMockOrchestrator() as never,
        { on: vi.fn(), off: vi.fn() } as never,
        { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
        linearPollService as never,
      );
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "boom" });
    });
  });

  describe("GET /api/events/stream", () => {
    it("streams an initial comment, forwards dashboard events, and cleans up on close", async () => {
      const handlers = new Map<string, (event: DashboardEvent) => void>();
      const mockEmitter = {
        on: vi.fn((channel: string, handler: (event: DashboardEvent) => void) => {
          handlers.set(channel, handler);
        }),
        off: vi.fn(),
      };
      app = Fastify({ logger: false });
      registerApiRoutes(
        app,
        buildMockOrchestrator() as never,
        mockEmitter as never,
        { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
      );
      await app.ready();
      const address = await app.listen({ port: 0, host: "127.0.0.1" });

      const controller = new AbortController();
      const response = await fetch(`${address}/api/events/stream`, { signal: controller.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      const firstChunk = await reader.read();
      expect(decoder.decode(firstChunk.value)).toBe(":\n\n");

      expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
      const dashboardHandler = handlers.get("dashboard")!;
      const sampleEvent: DashboardEvent = {
        type: "run:created",
        runId: "run-1",
        issueId: "LIN-1",
        repo: "org/repo",
        timestamp: "2026-01-01T00:00:00.000Z",
      };
      dashboardHandler(sampleEvent);

      const secondChunk = await reader.read();
      expect(decoder.decode(secondChunk.value)).toBe(`data: ${JSON.stringify(sampleEvent)}\n\n`);

      controller.abort();
      await reader.cancel().catch(() => {});
      await vi.waitFor(() => expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler));
    });
  });
});
