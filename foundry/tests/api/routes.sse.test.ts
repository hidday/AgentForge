import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

/**
 * The SSE route (`GET /api/events/stream`) writes directly to `reply.raw`
 * and never resolves/ends the response while the client stays connected, so
 * exercising it through `app.inject()` (which waits for the response to
 * finish) would hang indefinitely. Instead we register the routes against a
 * minimal fake Fastify app that just records the handler functions, then
 * invoke the SSE handler directly with fake request/reply objects.
 */
function buildFakeApp() {
  const routes = new Map<string, (...args: unknown[]) => unknown>();
  const app = {
    get: vi.fn((url: string, handler: (...args: unknown[]) => unknown) => {
      routes.set(`GET ${url}`, handler);
    }),
    post: vi.fn((url: string, handler: (...args: unknown[]) => unknown) => {
      routes.set(`POST ${url}`, handler);
    }),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
  return { app, routes };
}

function buildOrchestratorStub() {
  const repo = { findById: vi.fn(), findAll: vi.fn() };
  return {
    getRunRepo: () => repo,
    getArtifactRepo: () => ({ findByRunId: vi.fn(), findLatestByType: vi.fn() }),
    getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
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
    retryRun: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
  };
}

function buildFakeReply() {
  return {
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    },
  };
}

describe("GET /api/events/stream (SSE)", () => {
  let emitter: RunEventEmitter;
  let processRunner: { getActiveProcesses: ReturnType<typeof vi.fn>; getProcessOutput: ReturnType<typeof vi.fn> };
  let routes: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new RunEventEmitter();
    processRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };
    const built = buildFakeApp();
    routes = built.routes;
    registerApiRoutes(
      built.app as never,
      buildOrchestratorStub() as never,
      emitter,
      processRunner as never,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment ping on connect", () => {
    const handler = routes.get("GET /api/events/stream")!;
    const reply = buildFakeReply();
    const request = { raw: new EventEmitter() };

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("forwards dashboard events emitted after connect as SSE data frames", () => {
    const handler = routes.get("GET /api/events/stream")!;
    const reply = buildFakeReply();
    const request = { raw: new EventEmitter() };

    handler(request, reply);
    reply.raw.write.mockClear();

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    expect(reply.raw.write).toHaveBeenCalledTimes(1);
    const written = reply.raw.write.mock.calls[0]![0] as string;
    expect(written.startsWith("data: ")).toBe(true);
    const payload = JSON.parse(written.slice("data: ".length).trim()) as { type: string };
    expect(payload.type).toBe("run:created");
  });

  it("sends a heartbeat comment every 15 seconds", () => {
    const handler = routes.get("GET /api/events/stream")!;
    const reply = buildFakeReply();
    const request = { raw: new EventEmitter() };

    handler(request, reply);
    reply.raw.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");

    reply.raw.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("stops the heartbeat and unsubscribes from the emitter when the client disconnects", () => {
    const handler = routes.get("GET /api/events/stream")!;
    const reply = buildFakeReply();
    const request = { raw: new EventEmitter() };

    const offSpy = vi.spyOn(emitter, "off");
    handler(request, reply);

    request.raw.emit("close");
    expect(offSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));

    // After disconnect, further dashboard events must not be written, and the
    // heartbeat interval must have been cleared.
    reply.raw.write.mockClear();
    emitter.emitRunCreated("run-2", "LIN-2", "org/repo");
    vi.advanceTimersByTime(30_000);
    expect(reply.raw.write).not.toHaveBeenCalled();
  });

  it("supports multiple concurrent SSE clients independently", () => {
    const handler = routes.get("GET /api/events/stream")!;
    const replyA = buildFakeReply();
    const replyB = buildFakeReply();
    const requestA = { raw: new EventEmitter() };
    const requestB = { raw: new EventEmitter() };

    handler(requestA, replyA);
    handler(requestB, replyB);
    replyA.raw.write.mockClear();
    replyB.raw.write.mockClear();

    emitter.emitQuestionsAnswered("run-3", 1);

    expect(replyA.raw.write).toHaveBeenCalledTimes(1);
    expect(replyB.raw.write).toHaveBeenCalledTimes(1);

    requestA.raw.emit("close");
    replyA.raw.write.mockClear();
    replyB.raw.write.mockClear();

    emitter.emitQuestionsAnswered("run-4", 2);
    expect(replyA.raw.write).not.toHaveBeenCalled();
    expect(replyB.raw.write).toHaveBeenCalledTimes(1);
  });
});
