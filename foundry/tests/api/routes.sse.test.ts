import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

// The SSE route writes directly to `reply.raw` and never resolves the
// response, so it cannot be driven through Fastify's `inject()` (which waits
// for the response to end). Instead we build a minimal fake FastifyInstance
// that just records the (method, url) -> handler registrations made by
// registerApiRoutes, then invoke the "/api/events/stream" handler directly
// with fake request/reply objects.
function buildFakeApp() {
  const routes = new Map<string, (request: unknown, reply: unknown) => unknown>();
  const fakeApp = {
    get: (url: string, handler: (request: unknown, reply: unknown) => unknown) => {
      routes.set(`GET ${url}`, handler);
      return fakeApp;
    },
    post: (url: string, handler: (request: unknown, reply: unknown) => unknown) => {
      routes.set(`POST ${url}`, handler);
      return fakeApp;
    },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
  return { fakeApp, routes };
}

function buildRegisteredSseHandler() {
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

  const handler = routes.get("GET /api/events/stream");
  if (!handler) throw new Error("SSE route was not registered");
  return { handler, mockEmitter };
}

function buildFakeReply() {
  const raw = {
    writeHead: vi.fn(),
    write: vi.fn(),
  };
  return { raw };
}

function buildFakeRequest() {
  const raw = new EventEmitter();
  return { raw };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial keep-alive comment", () => {
    const { handler } = buildRegisteredSseHandler();
    const request = buildFakeRequest();
    const reply = buildFakeReply();

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("subscribes to the emitter's dashboard event and forwards events as SSE data", () => {
    const { handler, mockEmitter } = buildRegisteredSseHandler();
    const request = buildFakeRequest();
    const reply = buildFakeReply();

    handler(request, reply);

    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
    const dashboardHandler = mockEmitter.on.mock.calls[0][1] as (event: DashboardEvent) => void;

    const event: DashboardEvent = {
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    dashboardHandler(event);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("sends a heartbeat comment every 15 seconds", () => {
    const { handler } = buildRegisteredSseHandler();
    const request = buildFakeRequest();
    const reply = buildFakeReply();

    handler(request, reply);
    const writeCallsAfterInit = reply.raw.write.mock.calls.length;

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsAfterInit + 1);
    expect(reply.raw.write).toHaveBeenLastCalledWith(":\n\n");

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsAfterInit + 2);
  });

  it("clears the heartbeat and unsubscribes the listener when the request closes", () => {
    const { handler, mockEmitter } = buildRegisteredSseHandler();
    const request = buildFakeRequest();
    const reply = buildFakeReply();

    handler(request, reply);
    const dashboardHandler = mockEmitter.on.mock.calls[0][1] as (event: DashboardEvent) => void;

    request.raw.emit("close");

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    const writeCallsAtClose = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    // No further heartbeat writes should occur once the interval is cleared.
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsAtClose);
  });
});
