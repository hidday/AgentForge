import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

// The SSE route (`GET /api/events/stream`) never ends its response — it keeps
// the connection open and streams `dashboard` events until the client
// disconnects. That's awkward to exercise through a real HTTP injection
// (the request would simply hang), so instead we register the routes onto a
// minimal fake FastifyInstance that just records the handler passed to
// `app.get(url, handler)`, then invoke that handler directly against mock
// request/reply objects — asserting on the raw writes, subscription and
// cleanup behavior the route is responsible for.

function buildFakeApp() {
  const handlers = new Map<string, (request: unknown, reply: unknown) => void>();
  const app = {
    get: vi.fn((url: string, handler: (request: unknown, reply: unknown) => void) => {
      handlers.set(url, handler);
    }),
    post: vi.fn(),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
  return { app, handlers };
}

function buildMocks() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };
  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };
  const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };
  return { mockOrchestrator, mockProcessRunner };
}

function getStreamHandler() {
  const { app, handlers } = buildFakeApp();
  const { mockOrchestrator, mockProcessRunner } = buildMocks();

  const closeCallbacks: (() => void)[] = [];
  const request = {
    raw: {
      on: vi.fn((event: string, cb: () => void) => {
        if (event === "close") closeCallbacks.push(cb);
      }),
    },
  };
  const reply = {
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
    },
  };

  const dashboardListeners: ((event: DashboardEvent) => void)[] = [];
  const emitter = {
    on: vi.fn((channel: string, listener: (event: DashboardEvent) => void) => {
      if (channel === "dashboard") dashboardListeners.push(listener);
    }),
    off: vi.fn(),
  };

  registerApiRoutes(
    app as never,
    mockOrchestrator as never,
    emitter as never,
    mockProcessRunner as never,
  );

  const handler = handlers.get("/api/events/stream");
  if (!handler) throw new Error("SSE route was not registered");

  return { handler, request, reply, emitter, closeCallbacks, dashboardListeners };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment ping", () => {
    const { handler, request, reply, closeCallbacks } = getStreamHandler();

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");

    // cleanup so the interval doesn't leak into other tests
    closeCallbacks[0]?.();
  });

  it("subscribes to the emitter's dashboard channel and forwards events as SSE data frames", () => {
    const { handler, request, reply, emitter, dashboardListeners, closeCallbacks } =
      getStreamHandler();

    handler(request, reply);

    expect(emitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
    expect(dashboardListeners).toHaveLength(1);

    const event: DashboardEvent = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    dashboardListeners[0](event);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);

    closeCallbacks[0]?.();
  });

  it("sends a heartbeat comment ping every 15 seconds", () => {
    const { handler, request, reply, closeCallbacks } = getStreamHandler();

    handler(request, reply);
    reply.raw.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(reply.raw.write).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(2);

    closeCallbacks[0]?.();
  });

  it("registers a close handler that clears the heartbeat and unsubscribes the listener", () => {
    const { handler, request, reply, emitter, dashboardListeners, closeCallbacks } =
      getStreamHandler();

    handler(request, reply);
    expect(request.raw.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(closeCallbacks).toHaveLength(1);

    closeCallbacks[0]();

    expect(emitter.off).toHaveBeenCalledWith("dashboard", dashboardListeners[0]);

    // Heartbeat must be cancelled: advancing time after close produces no more writes.
    reply.raw.write.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(reply.raw.write).not.toHaveBeenCalled();
  });
});
