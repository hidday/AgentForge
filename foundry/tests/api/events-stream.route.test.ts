import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";

function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("timed out waiting for condition"));
      }
      setTimeout(check, 10);
    };
    check();
  });
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };

  const emitter = new EventEmitter();
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, emitter as never, mockProcessRunner as never);

  await app.ready();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return { app, emitter, port };
}

describe("GET /api/events/stream", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it(
    "sets SSE headers, writes an initial comment, forwards dashboard events, " +
      "sends heartbeats, and unsubscribes on client disconnect",
    async () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");

      const built = await buildApp();
      app = built.app;
      const { emitter, port } = built;

      const chunks: string[] = [];
      let req!: http.ClientRequest;
      const res = await new Promise<http.IncomingMessage>((resolve) => {
        req = http.get({ host: "127.0.0.1", port, path: "/api/events/stream" }, (response) => {
          response.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
          resolve(response);
        });
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.headers.connection).toBe("keep-alive");

      // Initial ":\n\n" comment is written immediately on connect.
      await waitFor(() => chunks.join("").includes(":\n\n"));
      expect(chunks.join("")).toBe(":\n\n");
      expect(emitter.listenerCount("dashboard")).toBe(1);

      // Emitting a dashboard event should be forwarded as an SSE data line.
      chunks.length = 0;
      emitter.emit("dashboard", {
        type: "run:created",
        runId: "run-1",
        issueId: "LIN-1",
        repo: "test-repo",
        timestamp: "2026-01-01T00:00:00.000Z",
      });
      await waitFor(() => chunks.join("").includes("run:created"));
      expect(chunks.join("")).toBe(
        'data: {"type":"run:created","runId":"run-1","issueId":"LIN-1","repo":"test-repo","timestamp":"2026-01-01T00:00:00.000Z"}\n\n',
      );

      // Manually invoke the captured heartbeat callback (registered with a
      // 15s interval) rather than waiting on a real 15-second timer.
      const heartbeatCall = setIntervalSpy.mock.calls.find((call) => call[1] === 15_000);
      expect(heartbeatCall).toBeDefined();
      chunks.length = 0;
      (heartbeatCall![0] as () => void)();
      await waitFor(() => chunks.join("") === ":\n\n");

      // Disconnecting the client triggers cleanup: listener removed, interval cleared.
      req.destroy();
      await waitFor(() => emitter.listenerCount("dashboard") === 0);
    },
  );
});
