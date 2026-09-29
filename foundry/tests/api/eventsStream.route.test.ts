import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

/**
 * The GET /api/events/stream handler never calls reply.send() and keeps a
 * 15s heartbeat interval alive for the lifetime of the connection, so
 * driving it through a real Fastify app.inject() call never resolves.
 * Instead we build a minimal fake FastifyInstance that just records the
 * handler registered for each route, then invoke that exact production
 * handler directly with hand-built request/reply doubles. This exercises
 * the real routes.ts code path deterministically without needing to fight
 * light-my-request's lack of a "close the underlying socket" hook.
 */
function buildFakeApp() {
  const routes = new Map<string, (...args: unknown[]) => unknown>();
  const fakeApp = {
    get: vi.fn((url: string, handler: (...args: unknown[]) => unknown) => {
      routes.set(url, handler);
    }),
    post: vi.fn(),
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  };
  return { fakeApp, routes };
}

function buildOrchestrator() {
  return {
    getRunRepo: () => ({ findById: vi.fn(), findAll: vi.fn() }),
    getArtifactRepo: () => ({ findByRunId: vi.fn(), findLatestByType: vi.fn() }),
    getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
  };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers, an initial comment, and subscribes the emitter to 'dashboard'", () => {
    const { fakeApp, routes } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      fakeApp as never,
      buildOrchestrator() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = routes.get("/api/events/stream");
    expect(handler).toBeTypeOf("function");

    const writeHead = vi.fn();
    const write = vi.fn();
    const requestRaw = new EventEmitter();
    const reply = { raw: { writeHead, write } };
    const request = { raw: requestRaw };

    handler!(request, reply);

    expect(writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(write).toHaveBeenCalledWith(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("writes a heartbeat comment every 15s while connected", () => {
    const { fakeApp, routes } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      fakeApp as never,
      buildOrchestrator() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = routes.get("/api/events/stream")!;
    const write = vi.fn();
    const reply = { raw: { writeHead: vi.fn(), write } };
    const request = { raw: new EventEmitter() };

    handler(request, reply);
    expect(write).toHaveBeenCalledTimes(1); // initial ":\n\n"

    vi.advanceTimersByTime(15_000);
    expect(write).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(15_000);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("forwards dashboard events emitted through the subscribed handler as SSE data frames", () => {
    const { fakeApp, routes } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      fakeApp as never,
      buildOrchestrator() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = routes.get("/api/events/stream")!;
    const write = vi.fn();
    const reply = { raw: { writeHead: vi.fn(), write } };
    const request = { raw: new EventEmitter() };

    handler(request, reply);

    const dashboardListener = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard")?.[1] as (
      e: DashboardEvent,
    ) => void;
    expect(dashboardListener).toBeTypeOf("function");

    const event: DashboardEvent = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    dashboardListener(event);

    expect(write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("unsubscribes the emitter and clears the heartbeat interval when the client disconnects", () => {
    const { fakeApp, routes } = buildFakeApp();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      fakeApp as never,
      buildOrchestrator() as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = routes.get("/api/events/stream")!;
    const write = vi.fn();
    const reply = { raw: { writeHead: vi.fn(), write } };
    const requestRaw = new EventEmitter();
    const request = { raw: requestRaw };

    handler(request, reply);
    const [, dashboardListener] = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard")!;

    requestRaw.emit("close");

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardListener);

    const writeCallsAtClose = write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    // Interval was cleared on close, so no further heartbeat writes occur.
    expect(write).toHaveBeenCalledTimes(writeCallsAtClose);
  });
});
