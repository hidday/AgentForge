import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { EventEmitter } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { registerApiRoutes } from "../../src/api/routes.js";

// The SSE route never ends its response, so app.inject() would hang. Instead
// we listen on an ephemeral port and read the raw stream with node:http.

async function startApp(emitter: EventEmitter) {
  const orchestrator = {
    getRunRepo: () => ({}),
    getArtifactRepo: () => ({}),
    getEventRepo: () => ({}),
  };
  const app = Fastify({ logger: false });
  registerApiRoutes(app, orchestrator as never, emitter as never, {} as never);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  return { app, port };
}

interface StreamClient {
  res: http.IncomingMessage;
  req: http.ClientRequest;
  /** Resolves once the accumulated body contains `needle`. */
  waitFor(needle: string): Promise<string>;
  /** Everything received so far. */
  body(): string;
}

function connect(port: number): Promise<StreamClient> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/events/stream" }, (res) => {
      let buf = "";
      const waiters: { needle: string; done: (s: string) => void }[] = [];
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        for (const w of [...waiters]) {
          if (buf.includes(w.needle)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.done(buf);
          }
        }
      });
      resolve({
        res,
        req,
        body: () => buf,
        waitFor: (needle) =>
          new Promise((done) => {
            if (buf.includes(needle)) done(buf);
            else waiters.push({ needle, done });
          }),
      });
    });
    req.on("error", reject);
  });
}

async function waitUntil(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.useRealTimers();
  if (app) {
    app.server.closeAllConnections();
    await app.close();
    app = undefined;
  }
});

describe("GET /api/events/stream (SSE)", () => {
  it("sends SSE headers and an initial comment, then forwards dashboard events as data frames", async () => {
    const emitter = new EventEmitter();
    const started = await startApp(emitter);
    app = started.app;

    const client = await connect(started.port);
    expect(client.res.statusCode).toBe(200);
    expect(client.res.headers["content-type"]).toBe("text/event-stream");
    expect(client.res.headers["cache-control"]).toBe("no-cache");
    expect(client.res.headers.connection).toBe("keep-alive");

    expect(await client.waitFor(":\n\n")).toBe(":\n\n");
    expect(emitter.listenerCount("dashboard")).toBe(1);

    const event = {
      type: "run:state-changed",
      runId: "run-1",
      from: "Planning",
      to: "PlanReview",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    emitter.emit("dashboard", event);

    const body = await client.waitFor("\n\ndata:");
    const frame = await client.waitFor("}\n\n");
    expect(body.startsWith(":\n\n")).toBe(true);
    expect(frame).toBe(`:\n\ndata: ${JSON.stringify(event)}\n\n`);

    client.req.destroy();
  });

  it("removes its dashboard listener when the client disconnects", async () => {
    const emitter = new EventEmitter();
    const started = await startApp(emitter);
    app = started.app;

    const client = await connect(started.port);
    await client.waitFor(":\n\n");
    expect(emitter.listenerCount("dashboard")).toBe(1);

    client.req.destroy();
    await waitUntil(() => emitter.listenerCount("dashboard") === 0);

    expect(emitter.listenerCount("dashboard")).toBe(0);
  });

  it("writes a heartbeat comment every 15s and stops after disconnect", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const emitter = new EventEmitter();
    const started = await startApp(emitter);
    app = started.app;

    const client = await connect(started.port);
    await client.waitFor(":\n\n");

    vi.advanceTimersByTime(14_999);
    // Only the initial comment so far.
    await new Promise((r) => setTimeout(r, 20));
    expect(client.body()).toBe(":\n\n");

    vi.advanceTimersByTime(1);
    expect(await client.waitFor(":\n\n:\n\n")).toBe(":\n\n:\n\n");

    client.req.destroy();
    await waitUntil(() => emitter.listenerCount("dashboard") === 0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
