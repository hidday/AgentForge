import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(opts: {
  processRunnerOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown> | undefined;
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

  return { app, mockProcessRunner };
}

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId filter is given", async () => {
    const processes = [
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ];
    const { app } = await buildApp({
      processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processes });
  });

  it("filters processes by runId when provided", async () => {
    const processes = [
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ];
    const { app } = await buildApp({
      processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processes: [processes[1]] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when there is no output for the process", async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns the process output when present", async () => {
    const { app, mockProcessRunner } = await buildApp({
      processRunnerOverrides: { getProcessOutput: vi.fn().mockReturnValue("stdout chunk") },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processId: "proc-1", output: "stdout chunk" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("proc-1");
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: "Linear polling not available (no LINEAR_API_KEY configured)",
    });
  });

  it("returns the discovered issues on success", async () => {
    const issues = [{ id: "issue-1" }];
    const discoverPendingIssues = vi.fn().mockResolvedValue(issues);
    const { app } = await buildApp({ linearPollService: { discoverPendingIssues } });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ issues });
  });

  it("returns 500 when discoverPendingIssues rejects", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue(new Error("Linear API down"));
    const { app } = await buildApp({ linearPollService: { discoverPendingIssues } });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Linear API down" });
  });

  it("returns 500 with a stringified error when discoverPendingIssues rejects with a non-Error value", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue("plain string failure");
    const { app } = await buildApp({ linearPollService: { discoverPendingIssues } });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["issue-1"] },
    });

    expect(response.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing", async () => {
    const { app } = await buildApp({ linearPollService: { startRunsForIssues: vi.fn() } });

    const response = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Required: { issueIds: string[] }" });
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const { app } = await buildApp({ linearPollService: { startRunsForIssues: vi.fn() } });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is not an array", async () => {
    const { app } = await buildApp({ linearPollService: { startRunsForIssues: vi.fn() } });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: "issue-1" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns ok + result from startRunsForIssues on success", async () => {
    const startRunsForIssues = vi.fn().mockResolvedValue({ started: 2, skipped: 1 });
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["issue-1", "issue-2"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, started: 2, skipped: 1 });
    expect(startRunsForIssues).toHaveBeenCalledWith(["issue-1", "issue-2"]);
  });

  it("returns 500 when startRunsForIssues rejects", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue(new Error("ingest failed"));
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["issue-1"] },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "ingest failed" });
  });

  it("returns 500 with a stringified error when startRunsForIssues rejects with a non-Error value", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue("ingest blew up");
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["issue-1"] },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "ingest blew up" });
  });
});
