import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";

// The SSE route (`GET /api/events/stream`) writes directly to `reply.raw`
// and never calls reply.send()/reply.raw.end() — it stays open until the
// client disconnects. Fastify's `.inject()` can't easily exercise a
// never-ending stream, so this test harness fakes just enough of the
// FastifyInstance surface (`get`/`post`/`log`) to capture the registered
// handler and invoke it directly with controllable fake request/reply
// objects, instead of spinning up a real HTTP server.
function buildFakeApp() {
  const getHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const postHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const app = {
    get: vi.fn((path: string, handler: (...args: unknown[]) => unknown) => {
      getHandlers.set(path, handler);
    }),
    post: vi.fn((path: string, handler: (...args: unknown[]) => unknown) => {
      postHandlers.set(path, handler);
    }),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
  return { app, getHandlers, postHandlers };
}

function buildOrchestratorStub() {
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

describe("GET /api/events/stream (SSE)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment heartbeat, then subscribes to the emitter's dashboard event", () => {
    const { app, getHandlers } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      app as never,
      buildOrchestratorStub() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = getHandlers.get("/api/events/stream");
    expect(handler).toBeDefined();

    const request = { raw: new EventEmitter() };
    const reply = buildFakeReply();
    handler!(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("forwards a dashboard event to the client as a 'data:' SSE message", () => {
    const { app, getHandlers } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      app as never,
      buildOrchestratorStub() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = getHandlers.get("/api/events/stream")!;
    const request = { raw: new EventEmitter() };
    const reply = buildFakeReply();
    handler(request, reply);

    const dashboardHandler = mockEmitter.on.mock.calls[0]![1] as (event: unknown) => void;
    const event = { type: "run:created", runId: "run-1", issueId: "LIN-1", repo: "r", timestamp: "t" };
    dashboardHandler(event);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("sends a ':\\n\\n' heartbeat comment every 15 seconds", () => {
    const { app, getHandlers } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      app as never,
      buildOrchestratorStub() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = getHandlers.get("/api/events/stream")!;
    const request = { raw: new EventEmitter() };
    const reply = buildFakeReply();
    handler(request, reply);

    const writeCallsBefore = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsBefore + 1);
    expect(reply.raw.write).toHaveBeenLastCalledWith(":\n\n");

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsBefore + 2);
  });

  it("unsubscribes from the emitter and clears the heartbeat when the request's raw connection closes", () => {
    const { app, getHandlers } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      app as never,
      buildOrchestratorStub() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = getHandlers.get("/api/events/stream")!;
    const request = { raw: new EventEmitter() };
    const reply = buildFakeReply();
    handler(request, reply);

    const dashboardHandler = mockEmitter.on.mock.calls[0]![1];
    request.raw.emit("close");

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    // After close, the heartbeat interval must be cleared: advancing time
    // must not produce any further writes.
    const writeCallsAfterClose = reply.raw.write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsAfterClose);
  });

  it("supports multiple concurrent SSE clients independently (separate handlers/cleanup)", () => {
    const { app, getHandlers } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      app as never,
      buildOrchestratorStub() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = getHandlers.get("/api/events/stream")!;
    const requestA = { raw: new EventEmitter() };
    const replyA = buildFakeReply();
    handler(requestA, replyA);

    const requestB = { raw: new EventEmitter() };
    const replyB = buildFakeReply();
    handler(requestB, replyB);

    expect(mockEmitter.on).toHaveBeenCalledTimes(2);

    // Closing client A must not affect client B's subscription.
    requestA.raw.emit("close");
    expect(mockEmitter.off).toHaveBeenCalledTimes(1);

    const dashboardHandlerB = mockEmitter.on.mock.calls[1]![1] as (event: unknown) => void;
    const event = { type: "run:created", runId: "run-2", issueId: "LIN-2", repo: "r", timestamp: "t" };
    dashboardHandlerB(event);
    expect(replyB.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });
});
