import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

type Handler = (request: unknown, reply: unknown) => void;

function buildFakeApp() {
  const routes: Record<string, Handler> = {};
  const app = {
    get: vi.fn((path: string, handler: Handler) => {
      routes[`GET ${path}`] = handler;
    }),
    post: vi.fn((path: string, handler: Handler) => {
      routes[`POST ${path}`] = handler;
    }),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { app, routes };
}

function buildOrchestratorStub() {
  return {
    getRunRepo: () => ({ findById: vi.fn(), findAll: vi.fn() }),
    getArtifactRepo: () => ({ findByRunId: vi.fn() }),
    getEventRepo: () => ({ findByRunId: vi.fn() }),
  };
}

function setup() {
  const { app, routes } = buildFakeApp();
  const emitter = new EventEmitter();
  const processRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };
  registerApiRoutes(
    app as never,
    buildOrchestratorStub() as never,
    emitter as never,
    processRunner as never,
  );

  const handler = routes["GET /api/events/stream"];
  const rawReply = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
  const rawRequest = new EventEmitter();

  return { handler, rawReply, rawRequest, emitter };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment to open the stream", () => {
    const { handler, rawReply, rawRequest } = setup();

    handler({ raw: rawRequest }, { raw: rawReply });

    expect(rawReply.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(rawReply.write).toHaveBeenCalledWith(":\n\n");
  });

  it("forwards dashboard events to the client as SSE data frames", () => {
    const { handler, rawReply, rawRequest, emitter } = setup();
    handler({ raw: rawRequest }, { raw: rawReply });

    const event: DashboardEvent = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "test-repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    emitter.emit("dashboard", event);

    expect(rawReply.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("fans out a single dashboard event to multiple connected clients", () => {
    const { app, routes } = buildFakeApp();
    const emitter = new EventEmitter();
    const processRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };
    registerApiRoutes(
      app as never,
      buildOrchestratorStub() as never,
      emitter as never,
      processRunner as never,
    );
    const handler = routes["GET /api/events/stream"];

    const replyA = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
    const requestA = new EventEmitter();
    const replyB = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
    const requestB = new EventEmitter();

    handler({ raw: requestA }, { raw: replyA });
    handler({ raw: requestB }, { raw: replyB });

    const event: DashboardEvent = {
      type: "run:questions-answered",
      runId: "run-1",
      questionCount: 2,
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    emitter.emit("dashboard", event);

    const frame = `data: ${JSON.stringify(event)}\n\n`;
    expect(replyA.write).toHaveBeenCalledWith(frame);
    expect(replyB.write).toHaveBeenCalledWith(frame);
  });

  it("sends a heartbeat comment every 15 seconds", () => {
    vi.useFakeTimers();
    const { handler, rawReply, rawRequest } = setup();
    handler({ raw: rawRequest }, { raw: rawReply });
    rawReply.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(rawReply.write).toHaveBeenCalledWith(":\n\n");

    rawReply.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(rawReply.write).toHaveBeenCalledWith(":\n\n");
  });

  it("removes the dashboard listener and stops the heartbeat when the client disconnects", () => {
    vi.useFakeTimers();
    const { handler, rawReply, rawRequest, emitter } = setup();
    const offSpy = vi.spyOn(emitter, "off");

    handler({ raw: rawRequest }, { raw: rawReply });
    expect(emitter.listenerCount("dashboard")).toBe(1);

    rawRequest.emit("close");

    expect(offSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));
    expect(emitter.listenerCount("dashboard")).toBe(0);

    rawReply.write.mockClear();

    // Further dashboard events must not reach the disconnected client.
    const event: DashboardEvent = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "test-repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    emitter.emit("dashboard", event);
    expect(rawReply.write).not.toHaveBeenCalled();

    // The heartbeat interval must be cleared too.
    vi.advanceTimersByTime(60_000);
    expect(rawReply.write).not.toHaveBeenCalled();
  });
});
