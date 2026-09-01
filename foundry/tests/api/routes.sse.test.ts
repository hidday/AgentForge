import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
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

  await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, emitter };
}

describe("GET /api/events/stream", () => {
  let app: Awaited<ReturnType<typeof buildApp>>["app"];
  let emitter: RunEventEmitter;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ app, emitter } = await buildApp());
  });

  afterEach(async () => {
    await app.close();
  });

  function addr(): string {
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected AddressInfo");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  it("sets SSE headers and streams a dashboard event to the client", async () => {
    const controller = new AbortController();
    const res = await fetch(`${addr()}/api/events/stream`, { signal: controller.signal });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // First chunk should be the initial comment/ping written on connect.
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe(":\n\n");

    // Emitting a dashboard event should push a formatted SSE `data:` frame.
    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");

    const second = await reader.read();
    const text = decoder.decode(second.value);
    expect(text.startsWith("data: ")).toBe(true);
    const payload = JSON.parse(text.slice("data: ".length).trim()) as {
      type: string;
      runId: string;
      issueId: string;
      repo: string;
    };
    expect(payload.type).toBe("run:created");
    expect(payload.runId).toBe("run-1");
    expect(payload.issueId).toBe("LIN-1");
    expect(payload.repo).toBe("test-repo");

    controller.abort();
    reader.releaseLock();
  });

  it("removes the listener when the client disconnects", async () => {
    const controller = new AbortController();
    const res = await fetch(`${addr()}/api/events/stream`, { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read(); // consume initial ping

    expect(emitter.listenerCount("dashboard")).toBe(1);

    controller.abort();
    reader.releaseLock();

    // Give the server a tick to process the close event.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(emitter.listenerCount("dashboard")).toBe(0);
  });

  it("supports multiple concurrent subscribers each receiving the same event", async () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const res1 = await fetch(`${addr()}/api/events/stream`, { signal: c1.signal });
    const res2 = await fetch(`${addr()}/api/events/stream`, { signal: c2.signal });
    const reader1 = res1.body!.getReader();
    const reader2 = res2.body!.getReader();
    await reader1.read();
    await reader2.read();

    expect(emitter.listenerCount("dashboard")).toBe(2);

    emitter.emitQuestionsAnswered("run-2", 3);

    const decoder = new TextDecoder();
    const [chunk1, chunk2] = await Promise.all([reader1.read(), reader2.read()]);
    const p1 = JSON.parse(decoder.decode(chunk1.value).slice("data: ".length).trim()) as {
      questionCount: number;
    };
    const p2 = JSON.parse(decoder.decode(chunk2.value).slice("data: ".length).trim()) as {
      questionCount: number;
    };
    expect(p1.questionCount).toBe(3);
    expect(p2.questionCount).toBe(3);

    c1.abort();
    c2.abort();
    reader1.releaseLock();
    reader2.releaseLock();
  });
});
