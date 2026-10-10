import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerApiRoutes } from "../../src/api/routes.js";

/**
 * The SSE route (`GET /api/events/stream`) writes directly to the raw Node
 * response and never resolves/ends the reply, which makes it impossible to
 * exercise via `app.inject` without hanging the test runner (inject waits
 * for the response to finish). Instead we build a minimal fake Fastify
 * instance that just records the registered route handlers, then invoke
 * the `/api/events/stream` handler directly with hand-rolled fake
 * `request`/`reply` objects that provide exactly the surface the handler
 * touches (`reply.raw.writeHead`/`write`, `request.raw.on("close", ...)`).
 */
function makeFakeApp() {
  const handlers = new Map<string, (request: unknown, reply: unknown) => unknown>();
  const fakeApp = {
    get(path: string, handler: (request: unknown, reply: unknown) => unknown) {
      handlers.set(`GET ${path}`, handler);
    },
    post(path: string, handler: (request: unknown, reply: unknown) => unknown) {
      handlers.set(`POST ${path}`, handler);
    },
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
  return { fakeApp, handlers };
}

function buildSseHandler() {
  const { fakeApp, handlers } = makeFakeApp();

  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
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
  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  registerApiRoutes(
    fakeApp as never,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  const handler = handlers.get("GET /api/events/stream");
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

  it("writes SSE headers, an initial comment, registers a dashboard listener, and tails events/heartbeats until close", () => {
    const { handler, mockEmitter } = buildSseHandler();

    const writeHead = vi.fn();
    const write = vi.fn();
    const closeListeners: (() => void)[] = [];

    const fakeReply = { raw: { writeHead, write } };
    const fakeRequest = {
      raw: {
        on: (event: string, cb: () => void) => {
          if (event === "close") closeListeners.push(cb);
        },
      },
    };

    handler(fakeRequest, fakeReply);

    // Headers + initial keep-alive comment
    expect(writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(write).toHaveBeenCalledWith(":\n\n");

    // Registered a dashboard listener on the emitter
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
    const dashboardHandler = mockEmitter.on.mock.calls[0][1] as (event: unknown) => void;

    // Simulate a dashboard event arriving — it should be written as an SSE data frame
    const event = { type: "run:created", runId: "run-1", issueId: "LIN-1", repo: "r", timestamp: "t" };
    dashboardHandler(event);
    expect(write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);

    // Heartbeat fires every 15s
    write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(write).toHaveBeenCalledWith(":\n\n");

    // Closing the connection tears down the heartbeat and removes the listener
    expect(closeListeners).toHaveLength(1);
    closeListeners[0]();
    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    write.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(write).not.toHaveBeenCalled();
  });
});
