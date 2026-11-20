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

  return { app, emitter };
}

async function wait(ms = 10) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("GET /api/events/stream", () => {
  let apps: FastifyInstance[] = [];
  let controllers: AbortController[] = [];

  beforeEach(() => {
    apps = [];
    controllers = [];
  });

  afterEach(async () => {
    for (const controller of controllers) {
      controller.abort();
    }
    await wait();
    for (const app of apps) {
      await app.close();
    }
  });

  it("writes SSE headers and an initial keep-alive comment", async () => {
    const { app, emitter } = await buildApp();
    apps.push(app);
    const controller = new AbortController();
    controllers.push(controller);

    const res = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
      signal: controller.signal,
    });

    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers.connection).toBe("keep-alive");

    const chunks: string[] = [];
    res.stream().on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    await wait();

    expect(chunks.join("")).toBe(":\n\n");
    expect(emitter.listenerCount("dashboard")).toBe(1);
  });

  it("writes a periodic keep-alive comment every 15 seconds while connected", async () => {
    vi.useFakeTimers();
    try {
      const { app, emitter } = await buildApp();
      apps.push(app);
      const controller = new AbortController();
      controllers.push(controller);

      const res = await app.inject({
        method: "GET",
        url: "/api/events/stream",
        payloadAsStream: true,
        signal: controller.signal,
      });

      const chunks: string[] = [];
      res.stream().on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
      await vi.advanceTimersByTimeAsync(0);
      expect(chunks.join("")).toBe(":\n\n");

      await vi.advanceTimersByTimeAsync(15_000);
      expect(chunks.join("")).toBe(":\n\n:\n\n");

      await vi.advanceTimersByTimeAsync(15_000);
      expect(chunks.join("")).toBe(":\n\n:\n\n:\n\n");

      expect(emitter.listenerCount("dashboard")).toBe(1);

      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(emitter.listenerCount("dashboard")).toBe(0);

      // The heartbeat interval must be cleared on disconnect — advancing well
      // past another interval should produce no further writes.
      const countAfterDisconnect = chunks.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(chunks.length).toBe(countAfterDisconnect);
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams dashboard events emitted after subscribing, formatted as SSE 'data:' lines", async () => {
    const { app, emitter } = await buildApp();
    apps.push(app);
    const controller = new AbortController();
    controllers.push(controller);

    const res = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
      signal: controller.signal,
    });

    const chunks: string[] = [];
    res.stream().on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    await wait();

    emitter.emitRunCreated("run-1", "LIN-1", "repo-a");
    await wait();

    const payload = chunks.join("");
    expect(payload).toContain("data: ");
    const dataLine = payload.split("\n").find((line) => line.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const event = JSON.parse(dataLine!.slice("data: ".length)) as {
      type: string;
      runId: string;
      issueId: string;
      repo: string;
    };
    expect(event.type).toBe("run:created");
    expect(event.runId).toBe("run-1");
    expect(event.issueId).toBe("LIN-1");
    expect(event.repo).toBe("repo-a");
  });

  it("supports multiple concurrent subscribers, each receiving the same event", async () => {
    const { app, emitter } = await buildApp();
    apps.push(app);
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    controllers.push(controllerA, controllerB);

    const resA = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
      signal: controllerA.signal,
    });
    const resB = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
      signal: controllerB.signal,
    });

    expect(emitter.listenerCount("dashboard")).toBe(2);

    const chunksA: string[] = [];
    const chunksB: string[] = [];
    resA.stream().on("data", (c: Buffer) => chunksA.push(c.toString()));
    resB.stream().on("data", (c: Buffer) => chunksB.push(c.toString()));
    await wait();

    emitter.emitArtifactCreated("run-9", "Plan", 1);
    await wait();

    expect(chunksA.join("")).toContain('"artifactType":"Plan"');
    expect(chunksB.join("")).toContain('"artifactType":"Plan"');
  });

  it("removes its listener and stops writing once the client disconnects", async () => {
    const { app, emitter } = await buildApp();
    apps.push(app);
    const controller = new AbortController();
    controllers.push(controller);

    const res = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
      signal: controller.signal,
    });

    const chunks: string[] = [];
    res.stream().on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    await wait();
    expect(emitter.listenerCount("dashboard")).toBe(1);

    controller.abort();
    await wait();

    expect(emitter.listenerCount("dashboard")).toBe(0);

    const chunkCountAfterDisconnect = chunks.length;
    emitter.emitRunCreated("run-2", "LIN-2", "repo-b");
    await wait();

    // No new data should arrive for this (now unsubscribed) client.
    expect(chunks.length).toBe(chunkCountAfterDisconnect);
  });

  it("disconnecting one subscriber does not affect another subscriber's listener", async () => {
    const { app, emitter } = await buildApp();
    apps.push(app);
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    controllers.push(controllerA, controllerB);

    await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
      signal: controllerA.signal,
    });
    const resB = await app.inject({
      method: "GET",
      url: "/api/events/stream",
      payloadAsStream: true,
      signal: controllerB.signal,
    });

    const chunksB: string[] = [];
    resB.stream().on("data", (c: Buffer) => chunksB.push(c.toString()));
    await wait();
    expect(emitter.listenerCount("dashboard")).toBe(2);

    controllerA.abort();
    await wait();
    expect(emitter.listenerCount("dashboard")).toBe(1);

    emitter.emitRunCreated("run-3", "LIN-3", "repo-c");
    await wait();
    expect(chunksB.join("")).toContain('"type":"run:created"');
  });
});
