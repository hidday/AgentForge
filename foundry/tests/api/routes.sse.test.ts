import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
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

function flush(times = 1): Promise<void> {
  return new Promise((resolve) => {
    let remaining = times;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else setImmediate(step);
    };
    setImmediate(step);
  });
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial keep-alive comment, and subscribes to dashboard events", async () => {
    const { app, mockEmitter } = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
      simulate: { close: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers.connection).toBe("keep-alive");

    const chunks: string[] = [];
    res.stream().on("data", (c: Buffer) => chunks.push(c.toString()));

    await flush(3);

    expect(chunks.join("")).toContain(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("forwards emitted dashboard events to the client as SSE data frames", async () => {
    const { app, mockEmitter } = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
    });

    const chunks: string[] = [];
    res.stream().on("data", (c: Buffer) => chunks.push(c.toString()));
    await flush(3);

    const handler = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard")?.[1] as (
      event: unknown,
    ) => void;
    expect(handler).toBeTypeOf("function");

    const event = {
      type: "run:state-changed",
      runId: "run-1",
      from: "Todo",
      to: "Planning",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    handler(event);
    await flush(3);

    expect(chunks.join("")).toContain(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("sends periodic heartbeats on the 15s interval", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { app } = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
    });

    const chunks: string[] = [];
    res.stream().on("data", (c: Buffer) => chunks.push(c.toString()));
    await flush(2);

    const beforeCount = chunks.join("").split(":\n\n").length;

    await vi.advanceTimersByTimeAsync(15_000);
    await flush(2);

    const afterCount = chunks.join("").split(":\n\n").length;
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  it("unsubscribes from dashboard events when the client connection closes", async () => {
    const { app, mockEmitter } = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
      simulate: { close: true },
    });
    res.stream().resume();
    (res.raw.res as unknown as { req: { resume: () => void } }).req.resume();

    await flush(10);

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", expect.any(Function));
    const onFn = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard")?.[1];
    const offFn = mockEmitter.off.mock.calls.find((c) => c[0] === "dashboard")?.[1];
    expect(offFn).toBe(onFn);
  });
});
