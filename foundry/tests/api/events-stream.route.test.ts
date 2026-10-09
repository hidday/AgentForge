import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

// The SSE route (`GET /api/events/stream`) never calls reply.send() — it
// holds the connection open and streams `dashboard` events until the
// client disconnects. Driving it through Fastify's `.inject()` would hang
// waiting for the response to finish, so instead we capture the raw route
// handler registerApiRoutes() hands to `app.get()` and invoke it directly
// against hand-built request/reply doubles that behave like Fastify's.

type RouteHandler = (request: unknown, reply: unknown) => unknown;

function buildMockApp() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(path, handler);
    }),
    post: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(path, handler);
    }),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
  return { app, routes };
}

function buildOrchestratorStub() {
  return {
    getRunRepo: () => ({}),
    getArtifactRepo: () => ({}),
    getEventRepo: () => ({}),
  };
}

describe("GET /api/events/stream", () => {
  let routes: Map<string, RouteHandler>;
  let emitterOn: ReturnType<typeof vi.fn>;
  let emitterOff: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    const built = buildMockApp();
    routes = built.routes;
    emitterOn = vi.fn();
    emitterOff = vi.fn();

    registerApiRoutes(
      built.app as never,
      buildOrchestratorStub() as never,
      { on: emitterOn, off: emitterOff } as never,
      { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function invokeStreamHandler() {
    const handler = routes.get("/api/events/stream");
    expect(handler).toBeDefined();

    const writes: unknown[] = [];
    const closeListeners: (() => void)[] = [];
    const request = {
      raw: {
        on: vi.fn((event: string, cb: () => void) => {
          if (event === "close") closeListeners.push(cb);
        }),
      },
    };
    const reply = {
      raw: {
        writeHead: vi.fn(),
        write: vi.fn((chunk: unknown) => writes.push(chunk)),
      },
    };

    handler!(request, reply);

    return { request, reply, writes, triggerClose: () => closeListeners.forEach((cb) => cb()) };
  }

  it("writes SSE headers and an initial comment heartbeat", () => {
    const { reply, writes } = invokeStreamHandler();

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(writes[0]).toBe(":\n\n");
  });

  it("subscribes to the emitter's dashboard channel", () => {
    invokeStreamHandler();

    expect(emitterOn).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("writes an SSE-formatted data line when a dashboard event fires", () => {
    const { writes } = invokeStreamHandler();

    const dashboardHandler = emitterOn.mock.calls[0][1] as (event: DashboardEvent) => void;
    const event: DashboardEvent = {
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    dashboardHandler(event);

    expect(writes).toContain(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("writes a heartbeat comment every 15 seconds", () => {
    const { writes } = invokeStreamHandler();
    const initialCount = writes.length;

    vi.advanceTimersByTime(15_000);
    expect(writes.length).toBe(initialCount + 1);
    expect(writes[writes.length - 1]).toBe(":\n\n");

    vi.advanceTimersByTime(15_000);
    expect(writes.length).toBe(initialCount + 2);
  });

  it("registers a close handler that clears the heartbeat and unsubscribes from the emitter", () => {
    const { request, triggerClose, writes } = invokeStreamHandler();

    expect(request.raw.on).toHaveBeenCalledWith("close", expect.any(Function));

    const countBeforeClose = writes.length;
    triggerClose();

    expect(emitterOff).toHaveBeenCalledWith("dashboard", expect.any(Function));
    // The same handler reference passed to `on` must be passed to `off`.
    expect(emitterOff.mock.calls[0][1]).toBe(emitterOn.mock.calls[0][1]);

    // Heartbeat must be cleared: advancing time after close produces no more writes.
    vi.advanceTimersByTime(60_000);
    expect(writes.length).toBe(countBeforeClose);
  });
});
