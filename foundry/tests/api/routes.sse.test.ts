import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

/**
 * GET /api/events/stream never completes its response (it streams SSE
 * frames and relies on the client closing the connection), so it cannot be
 * exercised with Fastify's `.inject()` the way the other routes are: that
 * call waits for the response to finish and would hang forever here.
 *
 * Instead we register the real routes against a minimal fake Fastify app
 * that just records the registered handlers, then invoke the captured
 * handler directly with mock Fastify request/reply objects. The dashboard
 * event bus is a *real* RunEventEmitter (not mocked), so subscribe/emit/
 * unsubscribe behavior is verified for real.
 */
function buildHandler() {
  const routeHandlers: Record<string, (request: unknown, reply: unknown) => void> = {};

  const fakeApp = {
    get: (path: string, ...rest: unknown[]) => {
      routeHandlers[path] = rest[rest.length - 1] as (request: unknown, reply: unknown) => void;
    },
    post: (path: string, ...rest: unknown[]) => {
      routeHandlers[path] = rest[rest.length - 1] as (request: unknown, reply: unknown) => void;
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };
  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const emitter = new RunEventEmitter();

  registerApiRoutes(
    fakeApp as never,
    mockOrchestrator as never,
    emitter as never,
    mockProcessRunner as never,
  );

  const handler = routeHandlers["/api/events/stream"];
  if (!handler) throw new Error("/api/events/stream route was not registered");

  return { handler, emitter };
}

function makeMockReply() {
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

  it("writes SSE headers and an initial comment frame", () => {
    const { handler } = buildHandler();
    const reply = makeMockReply();
    const request = { raw: new EventEmitter() };

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("forwards emitted dashboard events to the client as SSE data frames", () => {
    const { handler, emitter } = buildHandler();
    const reply = makeMockReply();
    const request = { raw: new EventEmitter() };

    handler(request, reply);
    reply.raw.write.mockClear();

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(reply.raw.write).toHaveBeenCalledTimes(1);
    const written = reply.raw.write.mock.calls[0][0] as string;
    expect(written.startsWith("data: ")).toBe(true);
    expect(written.endsWith("\n\n")).toBe(true);
    const payload = JSON.parse(written.slice("data: ".length, -2));
    expect(payload).toMatchObject({ type: "run:created", runId: "run-1", issueId: "LIN-1" });
  });

  it("delivers multiple events, one SSE frame per event", () => {
    const { handler, emitter } = buildHandler();
    const reply = makeMockReply();
    const request = { raw: new EventEmitter() };

    handler(request, reply);
    reply.raw.write.mockClear();

    emitter.emitChatReply("run-1", "hello", 10);
    emitter.emitQuestionsAnswered("run-1", 2);

    expect(reply.raw.write).toHaveBeenCalledTimes(2);
  });

  it("writes a heartbeat comment frame every 15 seconds", () => {
    const { handler } = buildHandler();
    const reply = makeMockReply();
    const request = { raw: new EventEmitter() };

    handler(request, reply);
    reply.raw.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(reply.raw.write).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(2);
  });

  it("stops the heartbeat and unsubscribes from the emitter once the request closes", () => {
    const { handler, emitter } = buildHandler();
    const reply = makeMockReply();
    const request = { raw: new EventEmitter() };

    handler(request, reply);
    expect(emitter.listenerCount("dashboard")).toBe(1);

    request.raw.emit("close");
    expect(emitter.listenerCount("dashboard")).toBe(0);

    reply.raw.write.mockClear();

    // Heartbeat must be cleared: advancing time should produce no more writes.
    vi.advanceTimersByTime(60_000);
    expect(reply.raw.write).not.toHaveBeenCalled();

    // And the emitter should no longer deliver events to this (closed) client.
    emitter.emitRunCreated("run-2", "LIN-2", "org/repo");
    expect(reply.raw.write).not.toHaveBeenCalled();
  });

  it("keeps separate concurrent clients independent (each gets its own listener and heartbeat)", () => {
    const { handler, emitter } = buildHandler();
    const replyA = makeMockReply();
    const replyB = makeMockReply();
    const requestA = { raw: new EventEmitter() };
    const requestB = { raw: new EventEmitter() };

    handler(requestA, replyA);
    handler(requestB, replyB);
    expect(emitter.listenerCount("dashboard")).toBe(2);

    replyA.raw.write.mockClear();
    replyB.raw.write.mockClear();

    emitter.emitRunCreated("run-3", "LIN-3", "org/repo");
    expect(replyA.raw.write).toHaveBeenCalledTimes(1);
    expect(replyB.raw.write).toHaveBeenCalledTimes(1);

    requestA.raw.emit("close");
    expect(emitter.listenerCount("dashboard")).toBe(1);

    replyA.raw.write.mockClear();
    replyB.raw.write.mockClear();

    emitter.emitRunCreated("run-4", "LIN-4", "org/repo");
    expect(replyA.raw.write).not.toHaveBeenCalled();
    expect(replyB.raw.write).toHaveBeenCalledTimes(1);
  });
});
