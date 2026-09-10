import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

type StreamHandler = (request: unknown, reply: unknown) => void;

async function buildAppAndCaptureStreamHandler() {
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

  const app = Fastify({ logger: false });

  // Intercept app.get so we can grab the raw stream-route handler and invoke
  // it directly with fake request/reply objects. The real handler never
  // calls reply.send()/reply.raw.end() (it's a long-lived SSE stream), so
  // driving it through app.inject() would hang waiting for the response to
  // finish. Route registration still happens normally via the real app.get.
  let streamHandler: StreamHandler | undefined;
  const originalGet = app.get.bind(app);
  app.get = ((url: string, ...rest: unknown[]) => {
    if (url === "/api/events/stream") {
      streamHandler = rest[rest.length - 1] as StreamHandler;
    }
    return (originalGet as (...args: unknown[]) => unknown)(url, ...rest);
  }) as typeof app.get;

  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );
  await app.ready();

  if (!streamHandler) throw new Error("Failed to capture /api/events/stream handler");
  return { app, mockEmitter, streamHandler };
}

function makeFakeReply() {
  return {
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    },
  };
}

function makeFakeRequest() {
  return { raw: new EventEmitter() };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment, and subscribes to the dashboard emitter", async () => {
    const { mockEmitter, streamHandler } = await buildAppAndCaptureStreamHandler();
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    streamHandler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("writes SSE-formatted data when the dashboard emitter fires an event", async () => {
    const { mockEmitter, streamHandler } = await buildAppAndCaptureStreamHandler();
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    streamHandler(request, reply);

    const [, handler] = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard") as [
      string,
      (event: unknown) => void,
    ];

    const fakeEvent = { type: "run-updated", runId: "run-1" };
    handler(fakeEvent);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(fakeEvent)}\n\n`);
  });

  it("writes a heartbeat comment every 15 seconds", async () => {
    const { streamHandler } = await buildAppAndCaptureStreamHandler();
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    streamHandler(request, reply);
    reply.raw.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");

    reply.raw.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("unsubscribes from the emitter and clears the heartbeat when the request closes", async () => {
    const { mockEmitter, streamHandler } = await buildAppAndCaptureStreamHandler();
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    streamHandler(request, reply);
    const [, handler] = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard") as [
      string,
      (event: unknown) => void,
    ];

    request.raw.emit("close");

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", handler);

    // Heartbeat must be cleared: advancing time after close should not write again.
    reply.raw.write.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(reply.raw.write).not.toHaveBeenCalled();
  });
});
