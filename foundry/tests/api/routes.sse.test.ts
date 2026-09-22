import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

/**
 * The SSE route (`GET /api/events/stream`) writes directly to the raw HTTP
 * response and never calls `reply.send()` / ends the response, which makes
 * it incompatible with Fastify's `app.inject()` (the injection promise only
 * resolves once the response ends). Instead we build a minimal fake
 * FastifyInstance that just records the registered route handlers, then
 * invoke the real handler from routes.ts directly with fake request/reply
 * objects — exercising the actual production code path.
 */
function buildFakeApp() {
  const getHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const postHandlers = new Map<string, (...args: unknown[]) => unknown>();

  const fakeApp = {
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    get: vi.fn((url: string, handler: (...args: unknown[]) => unknown) => {
      getHandlers.set(url, handler);
    }),
    post: vi.fn((url: string, handler: (...args: unknown[]) => unknown) => {
      postHandlers.set(url, handler);
    }),
  };

  return { fakeApp, getHandlers, postHandlers };
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

function buildFakeReply() {
  return {
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
    },
  };
}

function buildFakeRequest() {
  const closeHandlers: Array<() => void> = [];
  return {
    raw: {
      on: vi.fn((event: string, cb: () => void) => {
        if (event === "close") closeHandlers.push(cb);
      }),
    },
    closeHandlers,
  };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the SSE headers and an initial comment, and subscribes to the emitter", () => {
    const { fakeApp, getHandlers } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };

    registerApiRoutes(
      fakeApp as never,
      buildOrchestrator() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = getHandlers.get("/api/events/stream");
    expect(handler).toBeDefined();

    const reply = buildFakeReply();
    const request = buildFakeRequest();

    handler!(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("forwards emitted dashboard events to the client as SSE data frames", () => {
    const { fakeApp, getHandlers } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };

    registerApiRoutes(
      fakeApp as never,
      buildOrchestrator() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = getHandlers.get("/api/events/stream")!;
    const reply = buildFakeReply();
    const request = buildFakeRequest();
    handler(request, reply);

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
    const { fakeApp, getHandlers } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };

    registerApiRoutes(
      fakeApp as never,
      buildOrchestrator() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = getHandlers.get("/api/events/stream")!;
    const reply = buildFakeReply();
    const request = buildFakeRequest();
    handler(request, reply);

    const writeCallsBefore = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write.mock.calls.length).toBe(writeCallsBefore + 1);
    expect(reply.raw.write).toHaveBeenLastCalledWith(":\n\n");

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write.mock.calls.length).toBe(writeCallsBefore + 2);
  });

  it("clears the heartbeat interval and unsubscribes from the emitter when the connection closes", () => {
    const { fakeApp, getHandlers } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };

    registerApiRoutes(
      fakeApp as never,
      buildOrchestrator() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = getHandlers.get("/api/events/stream")!;
    const reply = buildFakeReply();
    const request = buildFakeRequest();
    handler(request, reply);

    expect(request.closeHandlers).toHaveLength(1);
    const dashboardHandler = mockEmitter.on.mock.calls[0][1];

    // Trigger the 'close' listener registered on request.raw.
    request.closeHandlers[0]!();

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    // The heartbeat must no longer fire after close.
    const writeCallsAtClose = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(reply.raw.write.mock.calls.length).toBe(writeCallsAtClose);
  });
});
