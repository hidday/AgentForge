import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
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

/**
 * Opens a streamed SSE connection via Fastify's inject(), and returns:
 * - the accumulated raw text written so far (as a getter)
 * - a function to simulate the client disconnecting (fires 'close' on the
 *   underlying request, exactly as a real socket close would)
 * - the Fastify response object itself
 */
async function openSseConnection(app: FastifyInstance) {
  const res = await app.inject({
    method: "GET",
    url: "/api/events/stream",
    payloadAsStream: true,
  });

  let data = "";
  const stream = res.stream();
  stream.on("data", (chunk: Buffer) => {
    data += chunk.toString("utf-8");
  });

  // Let the initial synchronous writes flush into the stream.
  await new Promise((resolve) => setImmediate(resolve));

  const simulateClose = () => {
    // res.raw.res.req is the same simulated IncomingMessage instance that
    // the route handler sees as `request.raw`.
    (res.raw.res as unknown as { req: NodeJS.EventEmitter }).req.emit("close");
  };

  return { res, getData: () => data, simulateClose };
}

describe("GET /api/events/stream", () => {
  let app: FastifyInstance;
  let emitter: RunEventEmitter;
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    setIntervalSpy = vi.spyOn(global, "setInterval");
    clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const built = await buildApp();
    app = built.app;
    emitter = built.emitter;
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it("responds with SSE headers and an initial comment, and subscribes to the dashboard channel", async () => {
    const { res, getData } = await openSseConnection(app);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers.connection).toBe("keep-alive");
    expect(getData()).toBe(":\n\n");
    expect(emitter.listenerCount("dashboard")).toBe(1);
  });

  it("schedules a 15s heartbeat interval on connect", async () => {
    await openSseConnection(app);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);
  });

  it("writes a keep-alive comment each time the heartbeat fires", async () => {
    const { getData } = await openSseConnection(app);
    const initialData = getData();

    const heartbeatCallback = setIntervalSpy.mock.calls[0][0] as () => void;
    heartbeatCallback();

    expect(getData()).toBe(`${initialData}:\n\n`);
  });

  it("writes emitted dashboard events to the stream as SSE 'data:' lines", async () => {
    const { getData } = await openSseConnection(app);

    emitter.emitRunCreated("run-1", "LIN-1", "org/repo");
    await new Promise((resolve) => setImmediate(resolve));

    const data = getData();
    expect(data).toContain("data: ");
    const [, payloadLine] = data.split("data: ");
    const parsed = JSON.parse(payloadLine.trim()) as {
      type: string;
      runId: string;
      issueId: string;
      repo: string;
    };
    expect(parsed.type).toBe("run:created");
    expect(parsed.runId).toBe("run-1");
    expect(parsed.issueId).toBe("LIN-1");
    expect(parsed.repo).toBe("org/repo");
    expect(data.endsWith("\n\n")).toBe(true);
  });

  it("delivers the same event to multiple concurrent SSE connections", async () => {
    const connA = await openSseConnection(app);
    const connB = await openSseConnection(app);
    expect(emitter.listenerCount("dashboard")).toBe(2);

    emitter.emitArtifactCreated("run-2", "Plan", 1);
    await new Promise((resolve) => setImmediate(resolve));

    expect(connA.getData()).toContain('"artifactType":"Plan"');
    expect(connB.getData()).toContain('"artifactType":"Plan"');
  });

  it("unsubscribes and clears the heartbeat when the client disconnects", async () => {
    const { simulateClose, getData } = await openSseConnection(app);
    expect(emitter.listenerCount("dashboard")).toBe(1);

    simulateClose();

    expect(emitter.listenerCount("dashboard")).toBe(0);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    // Further events must not be written once unsubscribed.
    const dataBeforeFurtherEmit = getData();
    emitter.emitRunCreated("run-3", "LIN-3", "org/repo");
    await new Promise((resolve) => setImmediate(resolve));
    expect(getData()).toBe(dataBeforeFurtherEmit);
  });

  it("disconnecting one client does not affect another client's subscription", async () => {
    const connA = await openSseConnection(app);
    const connB = await openSseConnection(app);

    connA.simulateClose();
    expect(emitter.listenerCount("dashboard")).toBe(1);

    emitter.emitRunCreated("run-4", "LIN-4", "org/repo");
    await new Promise((resolve) => setImmediate(resolve));

    expect(connB.getData()).toContain("run-4");
  });
});
