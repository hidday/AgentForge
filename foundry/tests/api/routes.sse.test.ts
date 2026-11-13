import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };

  // Use the real emitter so EventEmitter listener-count semantics (on/off,
  // and actual event delivery) are exercised end-to-end.
  const emitter = new RunEventEmitter();

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, emitter, mockProcessRunner as never);
  await app.ready();

  return { app, emitter };
}

function getStreamResponse(
  app: FastifyInstance,
): Promise<{ req: http.ClientRequest; res: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const address = app.server.address();
    if (!address || typeof address === "string") {
      reject(new Error("no address"));
      return;
    }
    const req = http.get(
      { host: "127.0.0.1", port: address.port, path: "/api/events/stream" },
      (res) => {
        resolve({ req, res });
      },
    );
    req.on("error", reject);
  });
}

function waitForChunk(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    res.on("data", (chunk: Buffer) => resolve(chunk.toString("utf-8")));
  });
}

describe("GET /api/events/stream", () => {
  let app: FastifyInstance;
  let emitter: RunEventEmitter;

  beforeEach(async () => {
    ({ app, emitter } = await buildApp());
    await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("responds with text/event-stream headers and an initial comment", async () => {
    const { req, res } = await getStreamResponse(app);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");

    const firstChunk = await waitForChunk(res);
    expect(firstChunk).toBe(":\n\n");

    req.destroy();
  });

  it("forwards dashboard events emitted on the emitter as SSE data frames", async () => {
    const { req, res } = await getStreamResponse(app);
    await waitForChunk(res); // the leading comment

    const nextChunk = waitForChunk(res);
    emitter.emitRunCreated("run-1", "LIN-1", "acme/repo");
    const frame = await nextChunk;

    expect(frame.startsWith("data: ")).toBe(true);
    const payload = JSON.parse(frame.slice("data: ".length).trim());
    expect(payload).toMatchObject({ type: "run:created", runId: "run-1", issueId: "LIN-1" });

    req.destroy();
  });

  it("stops forwarding events to a listener after the client disconnects", async () => {
    const { req, res } = await getStreamResponse(app);
    await waitForChunk(res);

    expect(emitter.listenerCount("dashboard")).toBe(1);

    req.destroy();
    // Give the server a tick to observe the socket close and run its cleanup.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(emitter.listenerCount("dashboard")).toBe(0);
  });

  it("does not deliver events emitted after the client has disconnected", async () => {
    const { req, res } = await getStreamResponse(app);
    await waitForChunk(res);

    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should be a no-op: no listeners remain, and emitting must not throw.
    expect(() => emitter.emitRunCreated("run-2", "LIN-2", "acme/repo")).not.toThrow();
  });
});
