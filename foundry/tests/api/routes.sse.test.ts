import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

/**
 * The SSE stream handler (GET /api/events/stream) never resolves its response
 * (it keeps the connection open with a heartbeat until the client disconnects),
 * which real fastify.inject() cannot exercise without hanging. Instead we build
 * a minimal fake FastifyInstance that records registered route handlers, so we
 * can invoke the SSE handler directly with fake request/reply objects and
 * assert its actual streaming behavior (headers, heartbeat, cleanup on close).
 */
type RouteHandler = (request: unknown, reply: unknown) => unknown;

function makeFakeApp() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(`GET ${path}`, handler);
    }),
    post: vi.fn((path: string, handler: RouteHandler) => {
      routes.set(`POST ${path}`, handler);
    }),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
  return { app, routes };
}

function makeOrchestrator() {
  return {
    getRunRepo: () => ({ findAll: vi.fn(), findById: vi.fn() }),
    getArtifactRepo: () => ({ findByRunId: vi.fn(), findLatestByType: vi.fn(), create: vi.fn() }),
    getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
    getAgentSkillRepo: () => undefined,
  };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers, a comment ping, forwards dashboard events, sends heartbeats, and cleans up on client close", () => {
    const { app, routes } = makeFakeApp();
    const emitter = new RunEventEmitter();
    const processRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      app as never,
      makeOrchestrator() as never,
      emitter,
      processRunner as never,
      undefined,
      {},
    );

    const handler = routes.get("GET /api/events/stream");
    expect(handler).toBeDefined();

    const rawResponse = {
      writeHead: vi.fn(),
      write: vi.fn(),
    };
    const rawRequest = new EventEmitter();
    const request = { raw: rawRequest };
    const reply = { raw: rawResponse };

    handler!(request, reply);

    expect(rawResponse.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // Initial comment ping to open the stream.
    expect(rawResponse.write).toHaveBeenCalledWith(":\n\n");

    // A dashboard event should be forwarded as an SSE "data:" line.
    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");
    const dataCall = rawResponse.write.mock.calls.find((c) => (c[0] as string).startsWith("data:"));
    expect(dataCall).toBeDefined();
    const payload = JSON.parse((dataCall![0] as string).replace(/^data: /, "").trim());
    expect(payload).toMatchObject({ type: "run:created", runId: "run-1" });

    // Heartbeat fires every 15s.
    const writesBefore = rawResponse.write.mock.calls.length;
    vi.advanceTimersByTime(15_000);
    expect(rawResponse.write.mock.calls.length).toBeGreaterThan(writesBefore);

    // On client disconnect, the heartbeat stops and the listener is removed.
    const listenerCountBefore = emitter.listenerCount("dashboard");
    expect(listenerCountBefore).toBeGreaterThan(0);
    rawRequest.emit("close");
    expect(emitter.listenerCount("dashboard")).toBe(listenerCountBefore - 1);

    const writesAtClose = rawResponse.write.mock.calls.length;
    vi.advanceTimersByTime(30_000);
    expect(rawResponse.write.mock.calls.length).toBe(writesAtClose);
  });

  it("does not forward events emitted after the client has closed", () => {
    const { app, routes } = makeFakeApp();
    const emitter = new RunEventEmitter();
    const processRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      app as never,
      makeOrchestrator() as never,
      emitter,
      processRunner as never,
      undefined,
      {},
    );

    const handler = routes.get("GET /api/events/stream")!;
    const rawResponse = { writeHead: vi.fn(), write: vi.fn() };
    const rawRequest = new EventEmitter();

    handler({ raw: rawRequest }, { raw: rawResponse });
    rawRequest.emit("close");
    rawResponse.write.mockClear();

    emitter.emitRunCreated("run-2", "LIN-2", "acme/repo");

    expect(rawResponse.write).not.toHaveBeenCalled();
  });
});
