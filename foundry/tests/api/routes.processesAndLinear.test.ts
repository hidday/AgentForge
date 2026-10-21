import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { registerApiRoutes } from "../../src/api/routes.js";

type RouteHandler = (...args: never[]) => unknown;

function buildHandlers(linearPollService?: Record<string, unknown>) {
  const handlers: Record<string, RouteHandler> = {};
  const fakeApp = {
    get: (path: string, handler: RouteHandler) => {
      handlers[`GET ${path}`] = handler;
    },
    post: (path: string, handler: RouteHandler) => {
      handlers[`POST ${path}`] = handler;
    },
  };

  const mockOrchestrator = {
    getRunRepo: () => ({ findAll: vi.fn(), findById: vi.fn() }),
    getArtifactRepo: () => ({ findByRunId: vi.fn() }),
    getEventRepo: () => ({ findByRunId: vi.fn() }),
  };

  const emitter = new EventEmitter();
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  registerApiRoutes(
    fakeApp as never,
    mockOrchestrator as never,
    emitter as never,
    mockProcessRunner as never,
    linearPollService as never,
    {},
  );

  return { handlers, emitter, mockProcessRunner };
}

function makeReply() {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn(),
  };
}

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const { handlers, mockProcessRunner } = buildHandlers();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const result = (await handlers["GET /api/processes"]({ query: {} } as never)) as {
      processes: unknown[];
    };

    expect(result.processes).toHaveLength(2);
  });

  it("filters active processes by runId when provided", async () => {
    const { handlers, mockProcessRunner } = buildHandlers();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const result = (await handlers["GET /api/processes"]({
      query: { runId: "run-2" },
    } as never)) as { processes: unknown[] };

    expect(result.processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns 404 when there is no output for the process", async () => {
    const { handlers, mockProcessRunner } = buildHandlers();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);
    const reply = makeReply();

    await handlers["GET /api/processes/:id/output"]({ params: { id: "missing" } } as never, reply as never);

    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("missing");
    expect(reply.code).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: "Process not found or no output available" });
  });

  it("returns the process output when present", async () => {
    const { handlers, mockProcessRunner } = buildHandlers();
    mockProcessRunner.getProcessOutput.mockReturnValue("build logs here");
    const reply = makeReply();

    const result = await handlers["GET /api/processes/:id/output"]({ params: { id: "p1" } } as never, reply as never);

    expect(result).toEqual({ processId: "p1", output: "build logs here" });
    expect(reply.code).not.toHaveBeenCalled();
  });
});

describe("GET /api/linear/pending", () => {
  it("returns 501 when linear polling is not configured", async () => {
    const { handlers } = buildHandlers(undefined);
    const reply = makeReply();

    await handlers["GET /api/linear/pending"]({} as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(501);
    expect(reply.send).toHaveBeenCalledWith({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns discovered issues on success", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-1" }]),
      startRunsForIssues: vi.fn(),
    };
    const { handlers } = buildHandlers(linearPollService);
    const reply = makeReply();

    const result = await handlers["GET /api/linear/pending"]({} as never, reply as never);

    expect(result).toEqual({ issues: [{ id: "LIN-1" }] });
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("returns 500 with the error message when discovery fails", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear API down")),
      startRunsForIssues: vi.fn(),
    };
    const { handlers } = buildHandlers(linearPollService);
    const reply = makeReply();

    await handlers["GET /api/linear/pending"]({} as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ error: "linear API down" });
  });

  it("returns 500 with a stringified error when a non-Error is thrown", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue("boom"),
      startRunsForIssues: vi.fn(),
    };
    const { handlers } = buildHandlers(linearPollService);
    const reply = makeReply();

    await handlers["GET /api/linear/pending"]({} as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ error: "boom" });
  });
});

describe("POST /api/linear/ingest", () => {
  it("returns 501 when linear polling is not configured", async () => {
    const { handlers } = buildHandlers(undefined);
    const reply = makeReply();

    await handlers["POST /api/linear/ingest"]({ body: { issueIds: ["LIN-1"] } } as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(501);
  });

  it.each([
    ["missing body", undefined],
    ["missing issueIds", {}],
    ["issueIds not an array", { issueIds: "LIN-1" }],
    ["empty issueIds array", { issueIds: [] }],
  ])("returns 400 when %s", async (_label, body) => {
    const linearPollService = { discoverPendingIssues: vi.fn(), startRunsForIssues: vi.fn() };
    const { handlers } = buildHandlers(linearPollService);
    const reply = makeReply();

    await handlers["POST /api/linear/ingest"]({ body } as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "Required: { issueIds: string[] }" });
    expect(linearPollService.startRunsForIssues).not.toHaveBeenCalled();
  });

  it("starts runs for the given issue ids on success", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"] }),
    };
    const { handlers } = buildHandlers(linearPollService);
    const reply = makeReply();

    const result = await handlers["POST /api/linear/ingest"]({ body: { issueIds: ["LIN-1"] } } as never, reply as never);

    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
    expect(result).toEqual({ ok: true, started: ["LIN-1"] });
  });

  it("returns 500 when starting runs fails", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("db unavailable")),
    };
    const { handlers } = buildHandlers(linearPollService);
    const reply = makeReply();

    await handlers["POST /api/linear/ingest"]({ body: { issueIds: ["LIN-1"] } } as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ error: "db unavailable" });
  });
});

describe("GET /api/events/stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers, forwards dashboard events, heartbeats, and cleans up on close", () => {
    const { handlers, emitter } = buildHandlers();
    const rawReply = { writeHead: vi.fn(), write: vi.fn() };
    const rawRequest = new EventEmitter();
    const reply = { raw: rawReply };
    const request = { raw: rawRequest };

    handlers["GET /api/events/stream"](request as never, reply as never);

    expect(rawReply.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(rawReply.write).toHaveBeenCalledWith(":\n\n");
    expect(emitter.listenerCount("dashboard")).toBe(1);

    const event = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "test-repo",
      timestamp: "2024-01-01T00:00:00.000Z",
    };
    emitter.emit("dashboard", event);
    expect(rawReply.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);

    rawReply.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(rawReply.write).toHaveBeenCalledWith(":\n\n");

    rawRequest.emit("close");
    expect(emitter.listenerCount("dashboard")).toBe(0);

    rawReply.write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(rawReply.write).not.toHaveBeenCalled();
  });
});
