import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";

// The SSE stream handler (`GET /api/events/stream`) never ends its response,
// so it can't be exercised through Fastify's app.inject(), which waits for
// the response to finish. Instead we register the routes against a minimal
// fake FastifyInstance that just records each (method, path, handler), and
// invoke the captured SSE handler directly with hand-built fake
// request/reply objects — exercising exactly the same route logic.

interface FakeRequest {
  query: Record<string, string>;
  raw: EventEmitter;
}

interface FakeReply {
  raw: {
    writeHead: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
}

function makeFakeApp() {
  const handlers = new Map<string, (req: FakeRequest, reply: FakeReply) => unknown>();
  const app = {
    get: vi.fn((path: string, handler: (req: FakeRequest, reply: FakeReply) => unknown) => {
      handlers.set(`GET ${path}`, handler);
    }),
    post: vi.fn((path: string, handler: (req: FakeRequest, reply: FakeReply) => unknown) => {
      handlers.set(`POST ${path}`, handler);
    }),
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
  return { app, handlers };
}

function makeOrchestrator() {
  const repo = { findById: vi.fn(), findAll: vi.fn() };
  return {
    getRunRepo: () => repo,
    getArtifactRepo: () => ({ findByRunId: vi.fn(), findLatestByType: vi.fn() }),
    getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
    getAgentSkillRepo: vi.fn(),
  };
}

function makeProcessRunner() {
  return { getActiveProcesses: vi.fn().mockReturnValue([]), getProcessOutput: vi.fn() };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial heartbeat comment", () => {
    const { app, handlers } = makeFakeApp();
    const emitter = { on: vi.fn(), off: vi.fn() };
    registerApiRoutes(
      app as never,
      makeOrchestrator() as never,
      emitter as never,
      makeProcessRunner() as never,
    );

    const handler = handlers.get("GET /api/events/stream")!;
    const reply: FakeReply = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const request: FakeRequest = { query: {}, raw: new EventEmitter() };

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(emitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("forwards dashboard events from the emitter as SSE data frames", () => {
    const { app, handlers } = makeFakeApp();
    const emitter = { on: vi.fn(), off: vi.fn() };
    registerApiRoutes(
      app as never,
      makeOrchestrator() as never,
      emitter as never,
      makeProcessRunner() as never,
    );

    const handler = handlers.get("GET /api/events/stream")!;
    const reply: FakeReply = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const request: FakeRequest = { query: {}, raw: new EventEmitter() };
    handler(request, reply);

    const dashboardHandler = emitter.on.mock.calls[0]![1] as (event: unknown) => void;
    const event = { type: "run:created", runId: "run-1", issueId: "LIN-1", repo: "x", timestamp: "now" };
    dashboardHandler(event);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("writes a heartbeat comment every 15 seconds", () => {
    const { app, handlers } = makeFakeApp();
    const emitter = { on: vi.fn(), off: vi.fn() };
    registerApiRoutes(
      app as never,
      makeOrchestrator() as never,
      emitter as never,
      makeProcessRunner() as never,
    );

    const handler = handlers.get("GET /api/events/stream")!;
    const reply: FakeReply = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const request: FakeRequest = { query: {}, raw: new EventEmitter() };
    handler(request, reply);

    const writesBefore = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write.mock.calls.length).toBe(writesBefore + 1);
    expect(reply.raw.write).toHaveBeenLastCalledWith(":\n\n");

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write.mock.calls.length).toBe(writesBefore + 2);
  });

  it("clears the heartbeat interval and detaches the dashboard listener when the request closes", () => {
    const { app, handlers } = makeFakeApp();
    const emitter = { on: vi.fn(), off: vi.fn() };
    registerApiRoutes(
      app as never,
      makeOrchestrator() as never,
      emitter as never,
      makeProcessRunner() as never,
    );

    const handler = handlers.get("GET /api/events/stream")!;
    const reply: FakeReply = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const request: FakeRequest = { query: {}, raw: new EventEmitter() };
    handler(request, reply);

    const dashboardHandler = emitter.on.mock.calls[0]![1];
    request.raw.emit("close");

    expect(emitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    const writesBeforeAdvance = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    // No further heartbeat writes should occur once the interval is cleared.
    expect(reply.raw.write.mock.calls.length).toBe(writesBeforeAdvance);
  });
});
