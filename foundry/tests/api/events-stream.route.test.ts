import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

/**
 * The SSE route writes directly to the raw Node HTTP response and never
 * calls reply.send(), so Fastify's `inject()` (which resolves once a
 * response completes) cannot exercise it. Instead we capture the route
 * handler Fastify would have registered and invoke it directly against
 * mock request/reply objects, as suggested for raw-stream routes.
 */
function buildFakeApp() {
  const routes: Record<string, (request: unknown, reply: unknown) => unknown> = {};
  const fakeApp = {
    get: vi.fn((path: string, handler: (request: unknown, reply: unknown) => unknown) => {
      routes[path] = handler;
    }),
    post: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { fakeApp, routes };
}

function buildMockReply() {
  return {
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
    },
  };
}

function buildMockRequest() {
  const closeHandlers: (() => void)[] = [];
  return {
    raw: {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "close") closeHandlers.push(handler);
      }),
    },
    closeHandlers,
  };
}

function setup() {
  const { fakeApp, routes } = buildFakeApp();
  const mockRunRepo = {};
  const mockArtifactRepo = {};
  const mockEventRepo = {};
  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };
  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {};

  registerApiRoutes(
    fakeApp as never,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  const handler = routes["/api/events/stream"];
  if (!handler) throw new Error("SSE route was not registered");
  return { handler, mockEmitter };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment heartbeat", () => {
    const { handler } = setup();
    const reply = buildMockReply();
    const request = buildMockRequest();

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("subscribes to the emitter's dashboard event and forwards events as SSE data frames", () => {
    const { handler, mockEmitter } = setup();
    const reply = buildMockReply();
    const request = buildMockRequest();

    handler(request, reply);

    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
    const dashboardHandler = mockEmitter.on.mock.calls[0][1] as (event: DashboardEvent) => void;

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

  it("writes a periodic heartbeat comment every 15 seconds", () => {
    const { handler } = setup();
    const reply = buildMockReply();
    const request = buildMockRequest();

    handler(request, reply);
    reply.raw.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");

    reply.raw.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("unsubscribes from the emitter and stops the heartbeat when the connection closes", () => {
    const { handler, mockEmitter } = setup();
    const reply = buildMockReply();
    const request = buildMockRequest();

    handler(request, reply);
    const dashboardHandler = mockEmitter.on.mock.calls[0][1];

    expect(request.closeHandlers).toHaveLength(1);
    request.closeHandlers[0]();

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    // Heartbeat must be cleared: advancing time should produce no further writes.
    reply.raw.write.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(reply.raw.write).not.toHaveBeenCalled();
  });
});
