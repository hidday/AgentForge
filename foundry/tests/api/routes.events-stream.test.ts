import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };

  const listeners = new Map<string, (event: DashboardEvent) => void>();
  const mockEmitter = {
    on: vi.fn((_channel: string, handler: (event: DashboardEvent) => void) => {
      listeners.set("dashboard", handler);
    }),
    off: vi.fn((_channel: string) => {
      listeners.delete("dashboard");
    }),
  };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.listen({ port: 0, host: "127.0.0.1" });

  return { app, mockEmitter, listeners };
}

function getPort(app: FastifyInstance): number {
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a network address for the listening server");
  }
  return address.port;
}

describe("GET /api/events/stream", () => {
  let app: FastifyInstance;

  beforeEach(() => vi.clearAllMocks());

  afterEach(async () => {
    if (app) {
      // Aborted keep-alive sockets can otherwise linger until Node's default
      // keepAliveTimeout, slowing teardown; force them closed immediately.
      app.server.closeAllConnections?.();
      await app.close();
    }
  });

  it("responds with SSE headers, registers a dashboard listener, and streams emitted events", async () => {
    const built = await buildApp();
    app = built.app;
    const port = getPort(app);

    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(built.mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // First chunk is the initial ":\n\n" comment written on connect.
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe(":\n\n");

    // Simulate the orchestrator emitting a dashboard event.
    const handler = built.listeners.get("dashboard")!;
    const event: DashboardEvent = {
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    handler(event);

    const second = await reader.read();
    const secondText = decoder.decode(second.value);
    expect(secondText).toBe(`data: ${JSON.stringify(event)}\n\n`);

    controller.abort();
    // Allow the server's "close" handler to run.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(built.mockEmitter.off).toHaveBeenCalledWith("dashboard", handler);
  });

  it("stops receiving events after the client disconnects (listener removed)", async () => {
    const built = await buildApp();
    app = built.app;
    const port = getPort(app);

    const controller = new AbortController();
    await fetch(`http://127.0.0.1:${port}/api/events/stream`, { signal: controller.signal });

    expect(built.listeners.has("dashboard")).toBe(true);

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(built.listeners.has("dashboard")).toBe(false);
  });
});
