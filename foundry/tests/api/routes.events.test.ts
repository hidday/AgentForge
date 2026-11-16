import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import { registerApiRoutes } from "../../src/api/routes.js";

/**
 * The /api/events/stream route writes directly to the raw HTTP response and
 * never calls reply.send()/reply.raw.end() — it is a long-lived SSE
 * connection that only terminates when the client disconnects. Fastify's
 * `inject()` waits for the response to finish, so it cannot be used here
 * without hanging. Instead we start a real (ephemeral-port) HTTP listener
 * and drive a real client connection, destroying it ourselves to exercise
 * the cleanup path.
 */
async function buildApp() {
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

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  await app.ready();
  return { app, mockEmitter };
}

function waitForClose(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("GET /api/events/stream", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("sends SSE headers, an initial comment, registers a dashboard listener, and cleans up on client disconnect", async () => {
    const built = await buildApp();
    app = built.app;
    const { mockEmitter } = built;

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a bound TCP address");
    }
    const { port } = address;

    const chunks: Buffer[] = [];
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/events/stream" }, (res) => {
        resolve(res);
      });
      req.on("error", reject);
      // Keep a reference so we can destroy the underlying socket later.
      (globalThis as { __testReq?: http.ClientRequest }).__testReq = req;
    });

    response.on("data", (chunk: Buffer) => chunks.push(chunk));

    // Give the initial write a tick to arrive.
    await waitForClose(50);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["connection"]).toBe("keep-alive");
    expect(Buffer.concat(chunks).toString()).toContain(":\n\n");

    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

    // Simulate a dashboard event being broadcast to this connection.
    const handler = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard")?.[1] as (
      event: unknown,
    ) => void;
    expect(typeof handler).toBe("function");
    chunks.length = 0;
    handler({ type: "run:created", runId: "run-9", issueId: "LIN-9", repo: "r", timestamp: "t" });
    await waitForClose(50);
    expect(Buffer.concat(chunks).toString()).toContain('"type":"run:created"');

    // Disconnect the client; the server's request.raw "close" listener
    // should clear the heartbeat interval and unsubscribe the handler.
    const req = (globalThis as { __testReq?: http.ClientRequest }).__testReq;
    req?.destroy();
    await waitForClose(150);

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", handler);
  });
});
