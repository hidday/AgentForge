import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

/**
 * The SSE route (`GET /api/events/stream`) never completes its response —
 * it holds the connection open until the client disconnects — so it can't
 * be exercised through Fastify's `.inject()` (which waits for the response
 * to finish). Instead we register the routes against a minimal stub
 * FastifyInstance that just records the handler function, then invoke that
 * handler directly against mock request/reply objects we control.
 */
function buildStubApp() {
  const routes: Record<string, (request: unknown, reply: unknown) => unknown> = {};
  const app = {
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    get(url: string, handler: (request: unknown, reply: unknown) => unknown) {
      routes[`GET ${url}`] = handler;
    },
    post(url: string, handler: (request: unknown, reply: unknown) => unknown) {
      routes[`POST ${url}`] = handler;
    },
  };
  return { app, routes };
}

function buildDeps() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
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
  return { mockOrchestrator, mockEmitter, mockProcessRunner };
}

function makeReply() {
  return {
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
    },
  };
}

function makeRequest() {
  return { raw: new EventEmitter() };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment ping", () => {
    const { app, routes } = buildStubApp();
    const { mockOrchestrator, mockEmitter, mockProcessRunner } = buildDeps();
    registerApiRoutes(app as never, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);

    const request = makeRequest();
    const reply = makeReply();
    routes["GET /api/events/stream"](request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("subscribes to the emitter's dashboard channel and forwards events as SSE data frames", () => {
    const { app, routes } = buildStubApp();
    const { mockOrchestrator, mockEmitter, mockProcessRunner } = buildDeps();
    registerApiRoutes(app as never, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);

    const request = makeRequest();
    const reply = makeReply();
    routes["GET /api/events/stream"](request, reply);

    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
    const [, dashboardHandler] = mockEmitter.on.mock.calls[0] as [string, (e: DashboardEvent) => void];

    const event: DashboardEvent = {
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
      timestamp: "2026-09-04T12:00:00.000Z",
    };
    dashboardHandler(event);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("sends a heartbeat comment every 15 seconds", () => {
    const { app, routes } = buildStubApp();
    const { mockOrchestrator, mockEmitter, mockProcessRunner } = buildDeps();
    registerApiRoutes(app as never, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);

    const request = makeRequest();
    const reply = makeReply();
    routes["GET /api/events/stream"](request, reply);

    const writesBefore = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write.mock.calls.length).toBeGreaterThan(writesBefore);
    expect(reply.raw.write).toHaveBeenLastCalledWith(":\n\n");

    const writesAfterOne = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write.mock.calls.length).toBeGreaterThan(writesAfterOne);
  });

  it("stops the heartbeat and unsubscribes from the emitter when the client disconnects", () => {
    const { app, routes } = buildStubApp();
    const { mockOrchestrator, mockEmitter, mockProcessRunner } = buildDeps();
    registerApiRoutes(app as never, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);

    const request = makeRequest();
    const reply = makeReply();
    routes["GET /api/events/stream"](request, reply);

    const [, dashboardHandler] = mockEmitter.on.mock.calls[0] as [string, (e: DashboardEvent) => void];

    request.raw.emit("close");

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    // Heartbeat interval must be cleared — advancing time should produce no further writes.
    const writesAtClose = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(reply.raw.write.mock.calls.length).toBe(writesAtClose);
  });

  it("supports multiple concurrent stream connections independently", () => {
    const { app, routes } = buildStubApp();
    const { mockOrchestrator, mockEmitter, mockProcessRunner } = buildDeps();
    registerApiRoutes(app as never, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);

    const requestA = makeRequest();
    const replyA = makeReply();
    routes["GET /api/events/stream"](requestA, replyA);

    const requestB = makeRequest();
    const replyB = makeReply();
    routes["GET /api/events/stream"](requestB, replyB);

    expect(mockEmitter.on).toHaveBeenCalledTimes(2);

    // Closing connection A must not affect B's listener.
    requestA.raw.emit("close");
    expect(mockEmitter.off).toHaveBeenCalledTimes(1);

    const [, handlerB] = mockEmitter.on.mock.calls[1] as [string, (e: DashboardEvent) => void];
    const event: DashboardEvent = {
      type: "run:created",
      runId: "run-2",
      issueId: "LIN-2",
      repo: "acme/x",
      timestamp: "2026-09-04T12:00:00.000Z",
    };
    handlerB(event);
    expect(replyB.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });
});
