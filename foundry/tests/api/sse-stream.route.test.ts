import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";

// The SSE route (GET /api/events/stream) deliberately never ends its HTTP
// response — it stays open until the client disconnects — so it can't be
// exercised through Fastify's normal `.inject()` (which waits for the
// response to finish). Instead we register the real routes against a
// minimal fake Fastify app that just records the handler for this one
// route, then invoke that handler directly with fake request/reply objects.

function makeFakeApp() {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const app = {
    get: (path: string, handler: (...args: unknown[]) => unknown) => {
      handlers[`GET ${path}`] = handler;
    },
    post: (path: string, handler: (...args: unknown[]) => unknown) => {
      handlers[`POST ${path}`] = handler;
    },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
  return { app, handlers };
}

function buildRoutes() {
  const { app, handlers } = makeFakeApp();
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };

  const emitter = new EventEmitter();
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  registerApiRoutes(app as never, mockOrchestrator as never, emitter as never, mockProcessRunner as never);

  return { handlers, emitter };
}

function makeFakeReply() {
  const raw = {
    writeHead: vi.fn(),
    write: vi.fn(),
  };
  return { raw };
}

function makeFakeRequest() {
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

  it("writes SSE headers and an initial comment, then subscribes to the dashboard emitter", () => {
    const { handlers, emitter } = buildRoutes();
    const handler = handlers["GET /api/events/stream"];
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(emitter.listenerCount("dashboard")).toBe(1);
  });

  it("forwards emitted dashboard events to the client as `data:` frames", () => {
    const { handlers, emitter } = buildRoutes();
    const handler = handlers["GET /api/events/stream"];
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    handler(request, reply);
    const event = { type: "run:state-changed", runId: "run-1" };
    emitter.emit("dashboard", event);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("sends a heartbeat comment every 15 seconds", () => {
    const { handlers } = buildRoutes();
    const handler = handlers["GET /api/events/stream"];
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    handler(request, reply);
    reply.raw.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");

    reply.raw.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("unsubscribes and stops the heartbeat when the client connection closes", () => {
    const { handlers, emitter } = buildRoutes();
    const handler = handlers["GET /api/events/stream"];
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    handler(request, reply);
    expect(emitter.listenerCount("dashboard")).toBe(1);

    request.raw.emit("close");
    expect(emitter.listenerCount("dashboard")).toBe(0);

    reply.raw.write.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(reply.raw.write).not.toHaveBeenCalled();
  });
});
