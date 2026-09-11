import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerApiRoutes } from "../../src/api/routes.js";

// The SSE route (`GET /api/events/stream`) never ends its response — it
// writes a heartbeat/comment and streams `dashboard` events indefinitely
// until the client disconnects. That's fundamentally incompatible with
// Fastify's `inject()`, whose returned promise only resolves once the
// simulated response has ended (confirmed experimentally: injecting this
// route with `simulate: { close: true }` still times out because the raw
// response stream is never closed). So we register the routes against a
// minimal fake Fastify-shaped app that just records the handler for each
// path/method, then invoke the SSE handler directly with fake
// request/reply objects — exercising exactly the same route logic
// (`registerApiRoutes`'s handler body) without fighting the transport.

type Handler = (request: unknown, reply: unknown) => void;

function buildFakeApp() {
  const routes: Record<string, Record<string, Handler>> = {};
  const record = (method: string) => (path: string, handler: Handler) => {
    routes[path] = routes[path] ?? {};
    routes[path][method] = handler;
  };
  const fakeApp = {
    get: vi.fn(record("GET")),
    post: vi.fn(record("POST")),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
  return { fakeApp, routes };
}

function buildFakeReply() {
  return {
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
    },
  };
}

function buildFakeRequest() {
  const closeListeners: Array<() => void> = [];
  return {
    raw: {
      on: vi.fn((event: string, cb: () => void) => {
        if (event === "close") closeListeners.push(cb);
      }),
    },
    triggerClose: () => {
      for (const cb of closeListeners) cb();
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

  function setup() {
    const { fakeApp, routes } = buildFakeApp();
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

    registerApiRoutes(
      fakeApp as never,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = routes["/api/events/stream"]?.GET;
    if (!handler) throw new Error("SSE route was not registered");
    return { handler, mockEmitter };
  }

  it("writes SSE headers and an initial comment, then subscribes to 'dashboard' events", () => {
    const { handler, mockEmitter } = setup();
    const reply = buildFakeReply();
    const request = buildFakeRequest();

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("forwards emitted dashboard events to the client as SSE data frames", () => {
    const { handler, mockEmitter } = setup();
    const reply = buildFakeReply();
    const request = buildFakeRequest();

    handler(request, reply);

    const dashboardHandler = mockEmitter.on.mock.calls[0][1] as (event: unknown) => void;
    const event = {
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "Implementing",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    dashboardHandler(event);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("writes a heartbeat comment every 15 seconds", () => {
    const { handler } = setup();
    const reply = buildFakeReply();
    const request = buildFakeRequest();

    handler(request, reply);
    const writeCallsAfterSetup = reply.raw.write.mock.calls.length;

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsAfterSetup + 1);
    expect(reply.raw.write).toHaveBeenLastCalledWith(":\n\n");

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsAfterSetup + 2);
  });

  it("unsubscribes and stops the heartbeat when the client connection closes", () => {
    const { handler, mockEmitter } = setup();
    const reply = buildFakeReply();
    const request = buildFakeRequest();

    handler(request, reply);
    const dashboardHandler = mockEmitter.on.mock.calls[0][1] as (event: unknown) => void;

    request.triggerClose();

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    const writeCallsAtClose = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    // Heartbeat interval was cleared on close, so no further writes occur.
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsAtClose);
  });
});
