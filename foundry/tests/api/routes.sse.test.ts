import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

/**
 * The SSE route hijacks the raw HTTP response (writeHead/write directly on
 * reply.raw) and never calls reply.send(), so it can't be driven through
 * Fastify's normal app.inject() response lifecycle. Instead, capture the
 * handler registered for the route directly from a duck-typed fake app.
 */
function captureRouteHandlers() {
  const routes = new Map<string, (request: unknown, reply: unknown) => void>();
  const fakeApp = {
    get: vi.fn((path: string, handler: (request: unknown, reply: unknown) => void) => {
      routes.set(`GET ${path}`, handler);
    }),
    post: vi.fn((path: string, handler: (request: unknown, reply: unknown) => void) => {
      routes.set(`POST ${path}`, handler);
    }),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
  return { fakeApp, routes };
}

function buildDeps() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn(), create: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn(), create: vi.fn() };
  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn(),
    getLinearClient: vi.fn(),
  };
  const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };
  return { mockOrchestrator, mockProcessRunner };
}

function makeFakeReply() {
  const raw = {
    writeHead: vi.fn(),
    write: vi.fn(),
  };
  return { raw };
}

function makeFakeRequest() {
  const raw = new EventEmitter();
  return { raw };
}

describe("GET /api/events/stream", () => {
  it("writes SSE headers and an initial comment, then forwards dashboard events as data: lines", () => {
    const { fakeApp, routes } = captureRouteHandlers();
    const emitter = new RunEventEmitter();
    const { mockOrchestrator, mockProcessRunner } = buildDeps();

    registerApiRoutes(fakeApp as never, mockOrchestrator as never, emitter, mockProcessRunner as never);

    const handler = routes.get("GET /api/events/stream")!;
    const request = makeFakeRequest();
    const reply = makeFakeReply();

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    const dataWrites = reply.raw.write.mock.calls.filter((c) => (c[0] as string).startsWith("data: "));
    expect(dataWrites).toHaveLength(1);
    const payload = JSON.parse((dataWrites[0][0] as string).slice("data: ".length).trim());
    expect(payload).toMatchObject({ type: "run:created", runId: "run-1" });
  });

  it("sends a heartbeat comment every 15 seconds while connected", () => {
    vi.useFakeTimers();
    try {
      const { fakeApp, routes } = captureRouteHandlers();
      const emitter = new RunEventEmitter();
      const { mockOrchestrator, mockProcessRunner } = buildDeps();

      registerApiRoutes(fakeApp as never, mockOrchestrator as never, emitter, mockProcessRunner as never);

      const handler = routes.get("GET /api/events/stream")!;
      const request = makeFakeRequest();
      const reply = makeFakeReply();

      handler(request, reply);
      reply.raw.write.mockClear();

      vi.advanceTimersByTime(15_000);
      expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");

      reply.raw.write.mockClear();
      vi.advanceTimersByTime(15_000);
      expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the heartbeat and unsubscribes from the emitter when the client disconnects", () => {
    vi.useFakeTimers();
    try {
      const { fakeApp, routes } = captureRouteHandlers();
      const emitter = new RunEventEmitter();
      const { mockOrchestrator, mockProcessRunner } = buildDeps();

      registerApiRoutes(fakeApp as never, mockOrchestrator as never, emitter, mockProcessRunner as never);

      const handler = routes.get("GET /api/events/stream")!;
      const request = makeFakeRequest();
      const reply = makeFakeReply();

      handler(request, reply);

      request.raw.emit("close");

      reply.raw.write.mockClear();
      vi.advanceTimersByTime(30_000);
      // No more heartbeats after close.
      expect(reply.raw.write).not.toHaveBeenCalled();

      // And no more dashboard events are forwarded either.
      emitter.emitRunCreated("run-2", "LIN-2", "org/repo");
      expect(reply.raw.write).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports multiple concurrent SSE clients independently", () => {
    const { fakeApp, routes } = captureRouteHandlers();
    const emitter = new RunEventEmitter();
    const { mockOrchestrator, mockProcessRunner } = buildDeps();

    registerApiRoutes(fakeApp as never, mockOrchestrator as never, emitter, mockProcessRunner as never);

    const handler = routes.get("GET /api/events/stream")!;
    const requestA = makeFakeRequest();
    const replyA = makeFakeReply();
    const requestB = makeFakeRequest();
    const replyB = makeFakeReply();

    handler(requestA, replyA);
    handler(requestB, replyB);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");

    const dataWritesA = replyA.raw.write.mock.calls.filter((c) => (c[0] as string).startsWith("data: "));
    const dataWritesB = replyB.raw.write.mock.calls.filter((c) => (c[0] as string).startsWith("data: "));
    expect(dataWritesA).toHaveLength(1);
    expect(dataWritesB).toHaveLength(1);

    requestA.raw.emit("close");
    replyA.raw.write.mockClear();
    replyB.raw.write.mockClear();

    emitter.emitRunCreated("run-2", "LIN-2", "org/repo");

    expect(replyA.raw.write).not.toHaveBeenCalled();
    expect(replyB.raw.write.mock.calls.some((c) => (c[0] as string).startsWith("data: "))).toBe(true);
  });
});
