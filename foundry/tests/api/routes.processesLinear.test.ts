import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(opts: {
  linearPollService?: Record<string, unknown>;
  processes?: { id: string; runId: string; pid: number; command: string; stage: string; runtime: string; startedAt: string; elapsedMs: number }[];
  processOutput?: string | null;
} = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
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

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue(opts.processes ?? []),
    getProcessOutput: vi.fn().mockReturnValue(opts.processOutput ?? null),
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

  return { app, mockProcessRunner };
}

function makeProcess(overrides: Record<string, unknown> = {}) {
  return {
    id: "proc-1",
    pid: 1234,
    command: "claude plan",
    runId: "run-1",
    stage: "planning",
    runtime: "claude-code",
    startedAt: new Date().toISOString(),
    elapsedMs: 100,
    ...overrides,
  };
}

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId filter is given", async () => {
    const processes = [makeProcess({ id: "p1", runId: "run-1" }), makeProcess({ id: "p2", runId: "run-2" })];
    const { app } = await buildApp({ processes });

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { id: string }[] };
    expect(body.processes).toHaveLength(2);
  });

  it("filters processes by runId querystring", async () => {
    const processes = [makeProcess({ id: "p1", runId: "run-1" }), makeProcess({ id: "p2", runId: "run-2" })];
    const { app } = await buildApp({ processes });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { id: string; runId: string }[] };
    expect(body.processes).toEqual([expect.objectContaining({ id: "p2", runId: "run-2" })]);
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when no output is available", async () => {
    const { app } = await buildApp({ processOutput: null });

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns { processId, output } when output is available", async () => {
    const { app, mockProcessRunner } = await buildApp({ processOutput: "line 1\nline 2\n" });

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "line 1\nline 2\n" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });

  it("treats empty string output as available (not null)", async () => {
    const { app } = await buildApp({ processOutput: "" });

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns { issues } on success", async () => {
    const issues = [{ id: "LIN-1", title: "Fix bug" }];
    const discoverPendingIssues = vi.fn().mockResolvedValue(issues);
    const { app } = await buildApp({
      linearPollService: { discoverPendingIssues, startRunsForIssues: vi.fn() },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues });
    expect(discoverPendingIssues).toHaveBeenCalledOnce();
  });

  it("returns 500 with the error message when discoverPendingIssues throws", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue(new Error("Linear API down"));
    const { app } = await buildApp({
      linearPollService: { discoverPendingIssues, startRunsForIssues: vi.fn() },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API down" });
  });

  it("stringifies a non-Error rejection from discoverPendingIssues", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue({ code: "ECONNRESET" });
    const { app } = await buildApp({
      linearPollService: { discoverPendingIssues, startRunsForIssues: vi.fn() },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: String({ code: "ECONNRESET" }) });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns 400 when issueIds is missing", async () => {
    const { app } = await buildApp({
      linearPollService: { discoverPendingIssues: vi.fn(), startRunsForIssues: vi.fn() },
    });

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Required: { issueIds: string[] }" });
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const { app } = await buildApp({
      linearPollService: { discoverPendingIssues: vi.fn(), startRunsForIssues: vi.fn() },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is not an array", async () => {
    const { app } = await buildApp({
      linearPollService: { discoverPendingIssues: vi.fn(), startRunsForIssues: vi.fn() },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: "LIN-1" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns { ok: true, ...result } on success", async () => {
    const startRunsForIssues = vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] });
    const { app } = await buildApp({
      linearPollService: { discoverPendingIssues: vi.fn(), startRunsForIssues },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 with the error message when startRunsForIssues throws", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue(new Error("DB unavailable"));
    const { app } = await buildApp({
      linearPollService: { discoverPendingIssues: vi.fn(), startRunsForIssues },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "DB unavailable" });
  });

  it("stringifies a non-Error rejection from startRunsForIssues", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue(7);
    const { app } = await buildApp({
      linearPollService: { discoverPendingIssues: vi.fn(), startRunsForIssues },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "7" });
  });
});
