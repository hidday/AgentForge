import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

function buildMockOrchestrator() {
  return {
    getRunRepo: () => ({ findById: vi.fn(), findAll: vi.fn(), findMissingTitles: vi.fn() }),
    getArtifactRepo: () => ({ findByRunId: vi.fn() }),
    getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
    getAgentSkillRepo: () => ({}),
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
    runManualReReview: vi.fn(),
    startRun: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    getLinearClient: vi.fn(),
  };
}

async function buildApp(opts: {
  processRunnerOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown>;
} = {}): Promise<{ app: FastifyInstance; mockProcessRunner: Record<string, unknown>; mockEmitter: Record<string, unknown> }> {
  const mockOrchestrator = buildMockOrchestrator();
  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
    ...opts.processRunnerOverrides,
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    opts.linearPollService as never,
  );
  await app.ready();
  return { app, mockProcessRunner, mockEmitter };
}

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId filter is given", async () => {
    const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
    const { app } = await buildApp({
      processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processes });
  });

  it("filters processes to the given runId", async () => {
    const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
    const { app } = await buildApp({
      processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processes: [{ id: "p2", runId: "run-2" }] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the process output when available", async () => {
    const { app } = await buildApp({
      processRunnerOverrides: { getProcessOutput: vi.fn().mockReturnValue("some output") },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processId: "p1", output: "some output" });
  });

  it("returns 404 when no output is available for the process", async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Process not found or no output available" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns discovered issues on success", async () => {
    const issues = [{ id: "LIN-1" }];
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue(issues),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ issues });
  });

  it("returns 500 with the error message when discoverPendingIssues throws an Error", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API down")),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Linear API down" });
  });

  it("returns 500 with a stringified message when discoverPendingIssues throws a non-Error", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue("boom"),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "boom" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Required: { issueIds: string[] }" });
    expect(linearPollService.startRunsForIssues).not.toHaveBeenCalled();
  });

  it("returns 400 when issueIds is not an array", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: "LIN-1" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("starts runs for the given issue ids and returns ok plus the service result", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 with the error message when startRunsForIssues throws", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("DB unavailable")),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "DB unavailable" });
  });
});

describe("GET /api/events/stream", () => {
  let app: FastifyInstance;
  let mockEmitter: Record<string, unknown>;

  beforeEach(async () => {
    const built = await buildApp();
    app = built.app;
    mockEmitter = built.mockEmitter;
  });

  afterEach(async () => {
    await app.close();
  });

  it("writes SSE headers, registers a dashboard listener, and deregisters it when the connection closes", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a bound TCP address");
    }
    const url = `http://127.0.0.1:${address.port}/api/events/stream`;

    const controller = new AbortController();
    const response = await fetch(url, { signal: controller.signal });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(":\n\n");

    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

    controller.abort();
    await reader.cancel().catch(() => undefined);

    await vi.waitFor(() => {
      expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", expect.any(Function));
    });
  });
});
