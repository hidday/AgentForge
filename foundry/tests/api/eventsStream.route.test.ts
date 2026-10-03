import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

type RouteHandler = (request: unknown, reply: unknown) => void;

/**
 * registerApiRoutes() is exercised against a minimal fake Fastify instance
 * (rather than a real one via app.inject) because the SSE route never calls
 * reply.send()/ends the stream — it hijacks reply.raw and keeps the
 * connection open indefinitely, which would hang a real inject() call.
 * Capturing the handler directly lets us drive it deterministically.
 */
function buildFakeApp() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(path, handler);
    }),
    post: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
  return { app, routes };
}

function buildOrchestrator() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };
  return {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };
}

function buildReply() {
  return {
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
    },
  };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment, and subscribes to the dashboard emitter", () => {
    const { app, routes } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(app as never, buildOrchestrator() as never, mockEmitter as never, mockProcessRunner as never);

    const handler = routes.get("/api/events/stream");
    expect(handler).toBeDefined();

    const request = { raw: new EventEmitter() };
    const reply = buildReply();

    handler!(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("forwards dashboard events to the client as SSE `data:` frames", () => {
    const { app, routes } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(app as never, buildOrchestrator() as never, mockEmitter as never, mockProcessRunner as never);

    const handler = routes.get("/api/events/stream")!;
    const request = { raw: new EventEmitter() };
    const reply = buildReply();

    handler(request, reply);

    const dashboardHandler = mockEmitter.on.mock.calls[0]![1] as (e: DashboardEvent) => void;
    const event: DashboardEvent = {
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-01-01T00:00:00.000Z",
    };

    dashboardHandler(event);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("sends a heartbeat comment every 15 seconds", () => {
    const { app, routes } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(app as never, buildOrchestrator() as never, mockEmitter as never, mockProcessRunner as never);

    const handler = routes.get("/api/events/stream")!;
    const request = { raw: new EventEmitter() };
    const reply = buildReply();

    handler(request, reply);
    reply.raw.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");

    reply.raw.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("stops the heartbeat and unsubscribes from the emitter when the client disconnects", () => {
    const { app, routes } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(app as never, buildOrchestrator() as never, mockEmitter as never, mockProcessRunner as never);

    const handler = routes.get("/api/events/stream")!;
    const request = { raw: new EventEmitter() };
    const reply = buildReply();

    handler(request, reply);
    const dashboardHandler = mockEmitter.on.mock.calls[0]![1];

    request.raw.emit("close");

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    reply.raw.write.mockClear();
    vi.advanceTimersByTime(60_000);
    // No more heartbeat writes should occur once the connection has closed.
    expect(reply.raw.write).not.toHaveBeenCalled();
  });
});
