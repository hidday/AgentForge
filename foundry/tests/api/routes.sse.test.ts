import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

// The SSE route never calls reply.send() -- it writes directly to the raw
// response and keeps the connection open -- so it cannot be exercised with
// app.inject() (which waits for the response to end). We instead start a
// real HTTP listener and drive it with a real socket, using the REAL
// RunEventEmitter so this also exercises its on/off/emit wiring end-to-end.

async function buildApp() {
  const mockRunRepo = { findAll: vi.fn().mockResolvedValue([]), findById: vi.fn().mockResolvedValue(null) };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]), findLatestByType: vi.fn(), create: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
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
    getLinearClient: vi.fn(),
  };

  const emitter = new RunEventEmitter();
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, emitter, mockProcessRunner as never);
  await app.ready();
  await app.listen({ port: 0, host: "127.0.0.1" });

  return { app, emitter };
}

function readNextChunk(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    res.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8")));
  });
}

describe("GET /api/events/stream", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("responds with SSE headers, an initial comment, forwards emitted dashboard events, and cleans up the listener on disconnect", async () => {
    const built = await buildApp();
    app = built.app;
    const { emitter } = built;
    const address = app.server.address() as AddressInfo;

    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: "/api/events/stream",
      method: "GET",
    });
    req.end();

    const res = await new Promise<http.IncomingMessage>((resolve) => {
      req.on("response", resolve);
    });

    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers.connection).toBe("keep-alive");

    // Initial heartbeat/comment written immediately on connect.
    const firstChunk = await readNextChunk(res);
    expect(firstChunk).toBe(":\n\n");

    expect(emitter.listenerCount("dashboard")).toBe(1);

    // Emitting a real dashboard event should be forwarded as an SSE `data:` line.
    const nextChunkPromise = readNextChunk(res);
    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");
    const eventChunk = await nextChunkPromise;
    expect(eventChunk).toMatch(/^data: /);
    const parsed = JSON.parse(eventChunk.replace(/^data: /, "").trim()) as {
      type: string;
      runId: string;
    };
    expect(parsed.type).toBe("run:created");
    expect(parsed.runId).toBe("run-1");

    // Destroying the client connection triggers the request's 'close' handler,
    // which must remove the dashboard listener (no leaked listeners/timers).
    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(emitter.listenerCount("dashboard")).toBe(0);
  });

  it("supports multiple concurrent SSE clients, each receiving the same broadcast event independently", async () => {
    const built = await buildApp();
    app = built.app;
    const { emitter } = built;
    const address = app.server.address() as AddressInfo;

    async function connect(): Promise<{ req: http.ClientRequest; res: http.IncomingMessage }> {
      const req = http.request({
        host: "127.0.0.1",
        port: address.port,
        path: "/api/events/stream",
        method: "GET",
      });
      req.end();
      const res = await new Promise<http.IncomingMessage>((resolve) => req.on("response", resolve));
      await readNextChunk(res); // consume the initial ":\n\n"
      return { req, res };
    }

    const clientA = await connect();
    const clientB = await connect();
    expect(emitter.listenerCount("dashboard")).toBe(2);

    const chunkA = readNextChunk(clientA.res);
    const chunkB = readNextChunk(clientB.res);
    emitter.emitQuestionsAnswered("run-2", 3);
    const [receivedA, receivedB] = await Promise.all([chunkA, chunkB]);
    expect(receivedA).toContain('"type":"run:questions-answered"');
    expect(receivedB).toContain('"type":"run:questions-answered"');

    clientA.req.destroy();
    clientB.req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(emitter.listenerCount("dashboard")).toBe(0);
  });

  it("writes a heartbeat comment on the 15s interval while the connection is open", async () => {
    // shouldAdvanceTime lets real I/O (the socket) keep flowing in real time
    // while we fast-forward the heartbeat's setInterval deterministically,
    // instead of the test actually waiting 15 real seconds.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const built = await buildApp();
      app = built.app;
      const address = app.server.address() as AddressInfo;

      const req = http.request({
        host: "127.0.0.1",
        port: address.port,
        path: "/api/events/stream",
        method: "GET",
      });
      req.end();

      const res = await new Promise<http.IncomingMessage>((resolve) => req.on("response", resolve));
      await readNextChunk(res); // initial ":\n\n"

      const heartbeatPromise = readNextChunk(res);
      await vi.advanceTimersByTimeAsync(15_000);
      const heartbeat = await heartbeatPromise;
      expect(heartbeat).toBe(":\n\n");

      req.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
