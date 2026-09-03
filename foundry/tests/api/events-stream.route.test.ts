import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

// The SSE route writes directly to the raw response and never ends the
// stream, so Fastify's `.inject()` never resolves for it. We exercise it
// over a real listening HTTP server instead, using node:http as the client.

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };

  const emitter = new RunEventEmitter();
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, emitter, mockProcessRunner as never);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { app, emitter, port };
}

function connectSSE(port: number) {
  return new Promise<{ req: http.ClientRequest; res: http.IncomingMessage; chunks: string[] }>(
    (resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api/events/stream`, (res) => {
        const chunks: string[] = [];
        res.on("data", (d: Buffer) => chunks.push(d.toString()));
        resolve({ req, res, chunks });
      });
      req.on("error", reject);
    },
  );
}

async function wait(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("GET /api/events/stream", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("responds with SSE headers and an initial heartbeat comment", async () => {
    const built = await buildApp();
    app = built.app;

    const { res, chunks, req } = await connectSSE(built.port);
    await wait(50);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers.connection).toBe("keep-alive");
    expect(chunks.join("")).toBe(":\n\n");

    req.destroy();
  });

  it("delivers an emitted dashboard event to a connected subscriber as an SSE data frame", async () => {
    const built = await buildApp();
    app = built.app;

    const { chunks, req } = await connectSSE(built.port);
    await wait(50);

    built.emitter.emitStateChanged("run-1", "Todo", "Planning");
    await wait(50);

    const payload = chunks.join("");
    const dataLine = payload.split("\n").find((l) => l.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const event = JSON.parse(dataLine!.slice("data: ".length)) as Record<string, unknown>;
    expect(event).toMatchObject({
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
    });
    expect(typeof event.timestamp).toBe("string");

    req.destroy();
  });

  it("delivers events independently to multiple concurrent subscribers", async () => {
    const built = await buildApp();
    app = built.app;

    const c1 = await connectSSE(built.port);
    const c2 = await connectSSE(built.port);
    await wait(50);

    expect(built.emitter.listenerCount("dashboard")).toBe(2);

    built.emitter.emitArtifactCreated("run-2", "Plan", 1);
    await wait(50);

    for (const c of [c1, c2]) {
      const payload = c.chunks.join("");
      expect(payload).toContain('"type":"run:artifact-created"');
      expect(payload).toContain('"runId":"run-2"');
    }

    c1.req.destroy();
    c2.req.destroy();
  });

  it("removes its listener (stops delivering events) once the client disconnects", async () => {
    const built = await buildApp();
    app = built.app;

    const { req } = await connectSSE(built.port);
    await wait(50);
    expect(built.emitter.listenerCount("dashboard")).toBe(1);

    req.destroy();

    await vi.waitFor(
      () => {
        expect(built.emitter.listenerCount("dashboard")).toBe(0);
      },
      { timeout: 2000, interval: 20 },
    );
  });

  it("the periodic heartbeat writes a keep-alive comment frame to the client", async () => {
    const built = await buildApp();
    app = built.app;

    // Capture the heartbeat callback instead of waiting a real 15s interval.
    let heartbeatFn: (() => void) | undefined;
    const fakeHandle = {} as NodeJS.Timeout;
    const setIntervalSpy = vi
      .spyOn(global, "setInterval")
      .mockImplementation(((fn: () => void) => {
        heartbeatFn = fn;
        return fakeHandle;
      }) as unknown as typeof setInterval);
    const clearIntervalSpy = vi.spyOn(global, "clearInterval").mockImplementation(() => undefined);

    const { chunks, req } = await connectSSE(built.port);
    await wait(50);

    try {
      expect(heartbeatFn).toBeDefined();
      chunks.length = 0; // discard the initial ":\n\n" comment already received

      heartbeatFn!();
      await wait(50);

      expect(chunks.join("")).toBe(":\n\n");
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      req.destroy();
    }
  });

  it("does not throw when an event is emitted with zero connected subscribers", async () => {
    const built = await buildApp();
    app = built.app;

    expect(built.emitter.listenerCount("dashboard")).toBe(0);
    expect(() => built.emitter.emitChatReply("run-1", "hi", 10)).not.toThrow();
  });
});
