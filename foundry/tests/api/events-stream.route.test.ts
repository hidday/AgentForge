import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { registerApiRoutes } from "../../src/api/routes.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

interface BuiltApp {
  app: FastifyInstance;
  getCapturedRaw: () => IncomingMessage | null;
  onHandlers: ((event: DashboardEvent) => void)[];
  offCalls: unknown[][];
}

async function buildApp(): Promise<BuiltApp> {
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

  const onHandlers: ((event: DashboardEvent) => void)[] = [];
  const offCalls: unknown[][] = [];
  const mockEmitter = {
    on: vi.fn((_eventName: string, handler: (event: DashboardEvent) => void) => {
      onHandlers.push(handler);
    }),
    off: vi.fn((...args: unknown[]) => {
      offCalls.push(args);
    }),
  };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });

  // Capture the raw request object for the SSE route so the test can
  // simulate the client disconnecting (emitting "close" on it), since the
  // route never calls reply.send()/end() on its own.
  let capturedRaw: IncomingMessage | null = null;
  app.addHook("onRequest", async (request) => {
    if (request.raw.url === "/api/events/stream") {
      capturedRaw = request.raw;
    }
  });

  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  await app.ready();

  return {
    app,
    getCapturedRaw: () => capturedRaw,
    onHandlers,
    offCalls,
  };
}

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers and an initial comment, and subscribes to the dashboard emitter", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.headers["connection"]).toBe("keep-alive");

    const chunks: string[] = [];
    const stream = response.stream();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

    await vi.advanceTimersByTimeAsync(0);
    expect(chunks.join("")).toBe(":\n\n");
  });

  it("forwards dashboard events written by the emitted handler to the client", async () => {
    const { app, onHandlers } = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
    });

    const chunks: string[] = [];
    const stream = response.stream();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    await vi.advanceTimersByTimeAsync(0);

    expect(onHandlers).toHaveLength(1);
    const event: DashboardEvent = {
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "AwaitingPlanApproval",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    onHandlers[0](event);

    const combined = chunks.join("");
    expect(combined).toContain(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("writes a heartbeat comment every 15 seconds", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
    });

    const chunks: string[] = [];
    const stream = response.stream();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    await vi.advanceTimersByTimeAsync(0);

    chunks.length = 0; // discard the initial comment
    await vi.advanceTimersByTimeAsync(15_000);

    expect(chunks.join("")).toBe(":\n\n");
  });

  it("unsubscribes from the emitter and stops the heartbeat when the client disconnects", async () => {
    const { app, getCapturedRaw, offCalls, onHandlers } = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
    });

    const chunks: string[] = [];
    const stream = response.stream();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    await vi.advanceTimersByTimeAsync(0);

    const raw = getCapturedRaw();
    expect(raw).not.toBeNull();
    raw!.emit("close");

    expect(offCalls).toHaveLength(1);
    expect(offCalls[0][0]).toBe("dashboard");
    expect(offCalls[0][1]).toBe(onHandlers[0]);

    chunks.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chunks.join("")).toBe("");
  });
});
