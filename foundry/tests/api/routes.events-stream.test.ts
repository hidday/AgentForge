import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);

  await app.ready();
  return { app, mockEmitter };
}

describe("GET /api/events/stream", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it(
    "writes SSE headers, streams dashboard events, and unsubscribes on close",
    async () => {
      const built = await buildApp();
      app = built.app;
      const mockEmitter = built.mockEmitter;

      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Failed to obtain server address");
      }
      const port = address.port;

      const setIntervalSpy = vi.spyOn(global, "setInterval");
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      const chunks: string[] = [];
      let headers: http.IncomingHttpHeaders | undefined;

      const closed = new Promise<void>((resolve, reject) => {
        const req = http.get(
          { host: "127.0.0.1", port, path: "/api/events/stream" },
          (res) => {
            headers = res.headers;
            res.on("data", (chunk: Buffer) => {
              chunks.push(chunk.toString());
              if (chunks.join("").includes("run:state-changed")) {
                req.destroy();
              }
            });
            res.on("close", () => resolve());
            res.on("error", () => resolve());
          },
        );
        req.on("error", () => resolve());
        setTimeout(() => reject(new Error("SSE test timed out")), 5000);
      });

      // Give the server a moment to register the dashboard listener.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
      const handlerCall = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard");
      const handler = handlerCall?.[1] as ((event: unknown) => void) | undefined;
      expect(typeof handler).toBe("function");

      handler!({
        type: "run:state-changed",
        runId: "run-1",
        from: "Planning",
        to: "AwaitingPlanApproval",
        timestamp: "2026-01-01T00:00:00.000Z",
      });

      await closed;

      expect(headers?.["content-type"]).toBe("text/event-stream");
      expect(headers?.["cache-control"]).toBe("no-cache");
      expect(headers?.["connection"]).toBe("keep-alive");

      const body = chunks.join("");
      expect(body).toContain(
        'data: {"type":"run:state-changed","runId":"run-1","from":"Planning","to":"AwaitingPlanApproval","timestamp":"2026-01-01T00:00:00.000Z"}',
      );

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);

      // Allow the request.raw "close" listener (which calls emitter.off) to run.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", handler);
      expect(clearIntervalSpy).toHaveBeenCalled();

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    },
    10_000,
  );

  it(
    "writes a second heartbeat comment on the wire when the 15s interval callback fires",
    async () => {
      const built = await buildApp();
      app = built.app;

      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Failed to obtain server address");
      }
      const port = address.port;

      const setIntervalSpy = vi.spyOn(global, "setInterval");

      const chunks: string[] = [];
      let req: http.ClientRequest;

      const closed = new Promise<void>((resolve, reject) => {
        req = http.get(
          { host: "127.0.0.1", port, path: "/api/events/stream" },
          (res) => {
            res.on("data", (chunk: Buffer) => {
              chunks.push(chunk.toString());
            });
            res.on("close", () => resolve());
            res.on("error", () => resolve());
          },
        );
        req.on("error", () => resolve());
        setTimeout(() => reject(new Error("SSE test timed out")), 5000);
      });

      // Give the server a moment to establish the connection and register the interval.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Locate the heartbeat interval registered by the route (delay 15_000ms)
      // and invoke its callback directly rather than waiting 15 real seconds.
      const heartbeatCall = setIntervalSpy.mock.calls.find((c) => c[1] === 15_000);
      expect(heartbeatCall).toBeDefined();
      const heartbeatCallback = heartbeatCall![0] as () => void;

      // Initial connection write already sent one ":\n\n" comment before we
      // started capturing here isn't guaranteed to be missed — capture length first.
      const beforeCount = chunks.join("").split(":\n\n").length - 1;

      heartbeatCallback();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const afterBody = chunks.join("");
      const afterCount = afterBody.split(":\n\n").length - 1;
      expect(afterCount).toBe(beforeCount + 1);

      req!.destroy();
      await closed;

      setIntervalSpy.mockRestore();
    },
    10_000,
  );
});
