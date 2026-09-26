import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

// The SSE route (`GET /api/events/stream`) never ends its response, so it
// can't be exercised with a plain `app.inject()` (which waits for the
// response to finish). Instead we bring the app up on a real ephemeral port
// and drive it with a real HTTP client so we can read partial chunks and
// then close the connection ourselves to trigger the server's cleanup path.

async function buildApp() {
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

function requestStream(app: FastifyInstance): Promise<http.IncomingMessage> {
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected server to be listening on a port");
  }
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port: address.port, path: "/api/events/stream" },
      (res) => resolve(res),
    );
    req.on("error", reject);
  });
}

function readChunk(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    res.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8")));
    res.once("error", reject);
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

  it("responds with SSE headers and an initial comment/heartbeat", async () => {
    const built = await buildApp();
    app = built.app;

    const res = await requestStream(app);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["connection"]).toBe("keep-alive");

    const firstChunk = await readChunk(res);
    expect(firstChunk).toBe(":\n\n");

    res.destroy();
  });

  it("forwards dashboard events emitted after connecting as SSE data frames", async () => {
    const built = await buildApp();
    app = built.app;
    const { emitter } = built;

    const res = await requestStream(app);
    await readChunk(res); // discard the initial ":\n\n" comment

    const nextChunk = readChunk(res);
    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    const chunk = await nextChunk;

    expect(chunk.startsWith("data: ")).toBe(true);
    const payload = JSON.parse(chunk.slice("data: ".length).trim()) as {
      type: string;
      runId: string;
      issueId: string;
      repo: string;
    };
    expect(payload.type).toBe("run:created");
    expect(payload.runId).toBe("run-1");
    expect(payload.issueId).toBe("LIN-1");
    expect(payload.repo).toBe("org/repo");

    res.destroy();
  });

  it("writes a periodic heartbeat comment on the 15s interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const built = await buildApp();
      app = built.app;

      const res = await requestStream(app);
      await readChunk(res); // initial ":\n\n" comment sent synchronously

      const heartbeat = readChunk(res);
      await vi.advanceTimersByTimeAsync(15_000);
      const chunk = await heartbeat;

      expect(chunk).toBe(":\n\n");

      res.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the dashboard listener once the client disconnects", async () => {
    const built = await buildApp();
    app = built.app;
    const { emitter } = built;

    const res = await requestStream(app);
    await readChunk(res); // initial comment

    expect(emitter.listenerCount("dashboard")).toBe(1);

    res.destroy();
    // Give the server a tick to observe the socket close and run its cleanup.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(emitter.listenerCount("dashboard")).toBe(0);
  });
});
