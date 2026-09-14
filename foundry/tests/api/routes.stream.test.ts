import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

// The SSE route (`GET /api/events/stream`) writes directly to the raw HTTP
// response and never calls reply.send()/reply.raw.end() — by design, the
// connection stays open until the client disconnects. Fastify's `inject()`
// only resolves once a response finishes, so it cannot drive this endpoint
// end-to-end. Instead we capture the real handler Fastify registered (via a
// spy on app.get) and invoke it directly with hand-built request/reply
// doubles, which lets us assert the actual wiring (headers, event
// forwarding, heartbeat, cleanup on client disconnect) deterministically.
function captureStreamHandler(app: FastifyInstance, emitter: RunEventEmitter) {
  const mockOrchestrator = {
    getRunRepo: () => ({ findById: vi.fn(), findAll: vi.fn() }),
    getArtifactRepo: () => ({ findByRunId: vi.fn(), findLatestByType: vi.fn(), create: vi.fn() }),
    getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runPlanning: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    retryRun: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
    getLinearClient: vi.fn(),
  };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const getSpy = vi.spyOn(app, "get");
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    emitter,
    mockProcessRunner as never,
    undefined,
    {},
  );

  const call = getSpy.mock.calls.find(([path]) => path === "/api/events/stream");
  if (!call) throw new Error("route /api/events/stream was not registered");
  // registerApiRoutes calls app.get(path, handler) with a 2-arg form for this route.
  const handler = call[1] as (request: unknown, reply: unknown) => void;
  getSpy.mockRestore();
  return handler;
}

function makeFakeReply() {
  return {
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
    },
  };
}

function makeFakeRequest() {
  return { raw: new EventEmitter() };
}

describe("GET /api/events/stream", () => {
  let emitter: RunEventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new RunEventEmitter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment ping", () => {
    const app = Fastify({ logger: false });
    const handler = captureStreamHandler(app, emitter);
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
  });

  it("forwards dashboard events to the client as SSE data frames", () => {
    const app = Fastify({ logger: false });
    const handler = captureStreamHandler(app, emitter);
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    handler(request, reply);
    reply.raw.write.mockClear();

    emitter.emitRunCreated("run-1", "issue-9", "org/repo");

    expect(reply.raw.write).toHaveBeenCalledOnce();
    const [payload] = reply.raw.write.mock.calls[0]!;
    expect(payload).toMatch(/^data: /);
    expect(payload).toMatch(/\n\n$/);
    const event = JSON.parse((payload as string).slice("data: ".length).trim());
    expect(event).toMatchObject({ type: "run:created", runId: "run-1", issueId: "issue-9" });
  });

  it("sends a heartbeat comment every 15 seconds", () => {
    const app = Fastify({ logger: false });
    const handler = captureStreamHandler(app, emitter);
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    handler(request, reply);
    reply.raw.write.mockClear();

    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(reply.raw.write).toHaveBeenCalledTimes(1);

    reply.raw.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(1);
  });

  it("stops the heartbeat and detaches the dashboard listener when the client disconnects", () => {
    const app = Fastify({ logger: false });
    const handler = captureStreamHandler(app, emitter);
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    handler(request, reply);
    expect(emitter.listenerCount("dashboard")).toBe(1);

    (request.raw as EventEmitter).emit("close");
    expect(emitter.listenerCount("dashboard")).toBe(0);

    reply.raw.write.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(reply.raw.write).not.toHaveBeenCalled();
  });

  it("does not forward events emitted after the client has disconnected", () => {
    const app = Fastify({ logger: false });
    const handler = captureStreamHandler(app, emitter);
    const reply = makeFakeReply();
    const request = makeFakeRequest();

    handler(request, reply);
    (request.raw as EventEmitter).emit("close");
    reply.raw.write.mockClear();

    emitter.emitRunCreated("run-2", "issue-1", "org/repo");

    expect(reply.raw.write).not.toHaveBeenCalled();
  });

  it("supports multiple concurrent stream clients independently", () => {
    const app = Fastify({ logger: false });
    const handler = captureStreamHandler(app, emitter);

    const replyA = makeFakeReply();
    const requestA = makeFakeRequest();
    handler(requestA, replyA);

    const replyB = makeFakeReply();
    const requestB = makeFakeRequest();
    handler(requestB, replyB);

    expect(emitter.listenerCount("dashboard")).toBe(2);

    replyA.raw.write.mockClear();
    replyB.raw.write.mockClear();
    emitter.emitQuestionsAnswered("run-3", 2);

    expect(replyA.raw.write).toHaveBeenCalledOnce();
    expect(replyB.raw.write).toHaveBeenCalledOnce();

    (requestA.raw as EventEmitter).emit("close");
    expect(emitter.listenerCount("dashboard")).toBe(1);

    replyA.raw.write.mockClear();
    replyB.raw.write.mockClear();
    emitter.emitQuestionsAnswered("run-4", 1);
    expect(replyA.raw.write).not.toHaveBeenCalled();
    expect(replyB.raw.write).toHaveBeenCalledOnce();
  });
});
