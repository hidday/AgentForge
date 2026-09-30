import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

/**
 * The /api/events/stream handler writes directly to the raw HTTP response
 * and never resolves/ends the reply (it stays open for the life of the SSE
 * connection). That makes it impossible to exercise through Fastify's
 * `app.inject()`, whose promise only resolves once the response finishes.
 *
 * Instead we register the routes against a minimal fake FastifyInstance
 * that just records the handlers passed to `.get()`/`.post()`, then invoke
 * the captured SSE handler directly with hand-built `request`/`reply`
 * doubles. This lets us assert on every statement/branch in the handler:
 * headers, the initial comment, event forwarding, the heartbeat interval,
 * and cleanup on client disconnect.
 */
function buildFakeApp() {
  const routes = new Map<string, (request: unknown, reply: unknown) => void>();
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const app = {
    get: (path: string, handler: (request: unknown, reply: unknown) => void) => {
      routes.set(`GET ${path}`, handler);
    },
    post: (path: string, handler: (request: unknown, reply: unknown) => void) => {
      routes.set(`POST ${path}`, handler);
    },
    log,
  };
  return { app, routes };
}

function buildOrchestrator() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn(), create: vi.fn() };
  return {
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
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers, an opening comment, forwards dashboard events, sends heartbeats, and cleans up on close", () => {
    const { app, routes } = buildFakeApp();
    const emitter = new EventEmitter() as EventEmitter & { on: typeof EventEmitter.prototype.on };
    const onSpy = vi.spyOn(emitter, "on");
    const offSpy = vi.spyOn(emitter, "off");

    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };

    registerApiRoutes(
      app as never,
      buildOrchestrator() as never,
      emitter as never,
      mockProcessRunner as never,
    );

    const handler = routes.get("GET /api/events/stream");
    expect(handler).toBeDefined();

    const rawResponse = { writeHead: vi.fn(), write: vi.fn() };
    const rawRequest = new EventEmitter();
    const request = { raw: rawRequest };
    const reply = { raw: rawResponse };

    handler!(request, reply);

    // Headers + initial keep-alive comment.
    expect(rawResponse.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(rawResponse.write).toHaveBeenCalledWith(":\n\n");
    expect(rawResponse.write).toHaveBeenCalledTimes(1);

    // The handler subscribes to the emitter's "dashboard" channel.
    expect(onSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));

    // Emitting a dashboard event forwards it as a formatted SSE data frame.
    const event: DashboardEvent = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    emitter.emit("dashboard", event);
    expect(rawResponse.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);

    // Heartbeat fires every 15s.
    vi.advanceTimersByTime(15_000);
    expect(rawResponse.write).toHaveBeenCalledWith(":\n\n");
    const writeCallsBeforeSecondHeartbeat = rawResponse.write.mock.calls.length;
    vi.advanceTimersByTime(15_000);
    expect(rawResponse.write.mock.calls.length).toBe(writeCallsBeforeSecondHeartbeat + 1);

    // Closing the underlying request tears down the heartbeat and unsubscribes.
    rawRequest.emit("close");
    expect(offSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));

    const writeCallsAtClose = rawResponse.write.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    // No further heartbeats after close — interval was cleared.
    expect(rawResponse.write.mock.calls.length).toBe(writeCallsAtClose);

    // And the emitter no longer forwards dashboard events to this connection.
    emitter.emit("dashboard", { ...event, runId: "run-2" });
    expect(rawResponse.write.mock.calls.length).toBe(writeCallsAtClose);
  });

  it("gives each connection its own handler so multiple concurrent streams don't cross-talk", () => {
    const { app, routes } = buildFakeApp();
    const emitter = new EventEmitter();
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };

    registerApiRoutes(
      app as never,
      buildOrchestrator() as never,
      emitter as never,
      mockProcessRunner as never,
    );
    const handler = routes.get("GET /api/events/stream")!;

    const connA = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const reqA = new EventEmitter();
    const connB = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const reqB = new EventEmitter();

    handler({ raw: reqA }, connA);
    handler({ raw: reqB }, connB);

    // Close only connection A.
    reqA.emit("close");

    const event: DashboardEvent = {
      type: "run:questions-answered",
      runId: "run-3",
      questionCount: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    emitter.emit("dashboard", event);

    // A no longer receives events (only its initial ":\n\n" write).
    expect(connA.raw.write).toHaveBeenCalledTimes(1);
    // B is still connected and receives the forwarded event.
    expect(connB.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });
});
