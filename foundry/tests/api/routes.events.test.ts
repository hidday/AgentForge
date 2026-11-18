import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";

// GET /api/events/stream holds its HTTP response open indefinitely (SSE):
// it never calls reply.send()/reply.raw.end(), so Fastify's `inject()` -
// which resolves only once the response ends - would hang forever on this
// route. Instead we bind a real ephemeral TCP listener and drive the route
// with a real `fetch()` call that we abort ourselves once we've read what
// we need, which lets the server's `request.raw.on("close", ...)` cleanup
// handler fire naturally, just like a real client disconnecting.
//
// A real RunEventEmitter (not a vi.fn() mock) is used so that `.on()` /
// `.off()` / `.emit()` behave like the production EventEmitter and we can
// verify the handler is actually wired up and later removed.

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

let runningApp: FastifyInstance | undefined;
let runningTimer: NodeJS.Timeout | undefined;

afterEach(async () => {
  if (runningTimer) {
    clearInterval(runningTimer);
    runningTimer = undefined;
  }
  if (runningApp) {
    await runningApp.close();
    runningApp = undefined;
  }
});

describe("GET /api/events/stream", () => {
  it("sends SSE headers, an initial heartbeat, forwards dashboard events, ticks the heartbeat, and cleans up on disconnect", async () => {
    const { app, emitter } = await buildApp();
    runningApp = app;

    const intervalSpy = vi.spyOn(global, "setInterval");
    const onSpy = vi.spyOn(emitter, "on");
    const offSpy = vi.spyOn(emitter, "off");

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(onSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Initial keep-alive comment, written synchronously on connect.
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(decoder.decode(first.value)).toBe(":\n\n");

    // A dashboard event emitted while connected should be forwarded as an
    // SSE `data:` line.
    emitter.emitRunCreated("run-1", "LIN-1", "test-repo");
    const second = await reader.read();
    const secondText = decoder.decode(second.value);
    expect(secondText.startsWith("data: ")).toBe(true);
    const parsed = JSON.parse(secondText.slice("data: ".length).trim()) as {
      type: string;
      runId: string;
      issueId: string;
      repo: string;
    };
    expect(parsed).toMatchObject({ type: "run:created", runId: "run-1", issueId: "LIN-1", repo: "test-repo" });

    // Manually fire the 15s heartbeat interval the route registered, rather
    // than waiting 15 real seconds.
    const heartbeatCall = intervalSpy.mock.calls.find((call) => call[1] === 15_000);
    expect(heartbeatCall).toBeDefined();
    const heartbeatCallback = heartbeatCall![0] as () => void;
    heartbeatCallback();

    const third = await reader.read();
    expect(decoder.decode(third.value)).toBe(":\n\n");

    // Capture the real interval handle so we can clear it ourselves as a
    // safety net regardless of whether the route's own cleanup runs.
    const lastResult = intervalSpy.mock.results[intervalSpy.mock.results.length - 1];
    if (lastResult?.type === "return") {
      runningTimer = lastResult.value as NodeJS.Timeout;
    }

    // Disconnect like a real client would; this should trigger the route's
    // request.raw "close" handler, clearing the interval and detaching the
    // emitter listener.
    controller.abort();
    await vi.waitFor(() => {
      expect(offSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));
    });

    intervalSpy.mockRestore();
  });
});
