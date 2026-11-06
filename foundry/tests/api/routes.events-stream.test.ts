import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

/**
 * The /api/events/stream route is a hand-rolled SSE endpoint: it writes
 * directly to the raw HTTP response and never calls reply.send(), so it
 * never completes a normal Fastify request/response cycle (there's an
 * open-ended heartbeat interval and a listener that lives until the
 * client disconnects). app.inject() waits for the response to end, so it
 * would hang forever here. Instead we build a minimal fake FastifyInstance
 * that just records the (path, handler) pairs passed to app.get/app.post,
 * then invoke the captured handler directly with hand-built request/reply
 * doubles — exercising the exact same code path without going over HTTP.
 */
function buildFakeApp() {
  const getHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const postHandlers = new Map<string, (...args: unknown[]) => unknown>();

  const fakeApp = {
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    get: vi.fn((path: string, ...rest: unknown[]) => {
      getHandlers.set(path, rest[rest.length - 1] as (...args: unknown[]) => unknown);
    }),
    post: vi.fn((path: string, ...rest: unknown[]) => {
      postHandlers.set(path, rest[rest.length - 1] as (...args: unknown[]) => unknown);
    }),
  };

  return { fakeApp, getHandlers, postHandlers };
}

function buildOrchestratorAndDeps() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
  };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  return { mockOrchestrator, mockProcessRunner };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers, an initial comment, forwards dashboard events, heartbeats, and cleans up on close", () => {
    const { fakeApp, getHandlers } = buildFakeApp();
    const { mockOrchestrator, mockProcessRunner } = buildOrchestratorAndDeps();

    const onHandlers = new Map<string, (event: DashboardEvent) => void>();
    const mockEmitter = {
      on: vi.fn((event: string, handler: (event: DashboardEvent) => void) => {
        onHandlers.set(event, handler);
      }),
      off: vi.fn(),
    };

    registerApiRoutes(
      fakeApp as never,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const streamHandler = getHandlers.get("/api/events/stream");
    expect(streamHandler).toBeDefined();

    const rawWrite = vi.fn();
    const rawWriteHead = vi.fn();
    const closeCallbacks: Array<() => void> = [];
    const request = {
      raw: {
        on: vi.fn((event: string, cb: () => void) => {
          if (event === "close") closeCallbacks.push(cb);
        }),
      },
    };
    const reply = {
      raw: { writeHead: rawWriteHead, write: rawWrite },
    };

    streamHandler!(request, reply);

    // Headers for an SSE stream.
    expect(rawWriteHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // Initial comment/ping so the client sees the connection is alive.
    expect(rawWrite).toHaveBeenCalledWith(":\n\n");

    // Subscribed to the emitter's "dashboard" channel.
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
    const dashboardHandler = onHandlers.get("dashboard");
    expect(dashboardHandler).toBeDefined();

    // Forwards a dashboard event as a properly framed SSE "data:" line.
    rawWrite.mockClear();
    const event: DashboardEvent = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: new Date().toISOString(),
    };
    dashboardHandler!(event);
    expect(rawWrite).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);

    // Heartbeat fires every 15s.
    rawWrite.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(rawWrite).toHaveBeenCalledWith(":\n\n");

    // On client disconnect: unsubscribe from the emitter and stop heartbeats.
    expect(request.raw.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(closeCallbacks).toHaveLength(1);
    closeCallbacks[0]();
    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    rawWrite.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(rawWrite).not.toHaveBeenCalled();
  });

  it("gives each connection its own independent handler/interval", () => {
    const { fakeApp, getHandlers } = buildFakeApp();
    const { mockOrchestrator, mockProcessRunner } = buildOrchestratorAndDeps();

    const mockEmitter = { on: vi.fn(), off: vi.fn() };

    registerApiRoutes(
      fakeApp as never,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const streamHandler = getHandlers.get("/api/events/stream")!;

    const makeConn = () => ({
      request: { raw: { on: vi.fn() } },
      reply: { raw: { writeHead: vi.fn(), write: vi.fn() } },
    });

    const connA = makeConn();
    const connB = makeConn();
    streamHandler(connA.request, connA.reply);
    streamHandler(connB.request, connB.reply);

    expect(mockEmitter.on).toHaveBeenCalledTimes(2);
    const [, handlerA] = mockEmitter.on.mock.calls[0] as [string, (e: DashboardEvent) => void];
    const [, handlerB] = mockEmitter.on.mock.calls[1] as [string, (e: DashboardEvent) => void];
    expect(handlerA).not.toBe(handlerB);
  });
});
