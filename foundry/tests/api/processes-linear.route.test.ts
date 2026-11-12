import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(opts: { withLinearPollService?: boolean } = {}) {
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

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockLinearPollService = opts.withLinearPollService
    ? {
        discoverPendingIssues: vi.fn(),
        startRunsForIssues: vi.fn(),
      }
    : undefined;

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    mockLinearPollService as never,
  );

  await app.ready();
  return { app, mockProcessRunner, mockLinearPollService };
}

describe("GET /api/processes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const response = await app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { processes: { id: string; runId: string }[] };
    expect(body.processes).toHaveLength(2);
  });

  it("filters active processes by runId querystring", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { processes: { id: string; runId: string }[] };
    expect(body.processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when there is no output for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const response = await app.inject({ method: "GET", url: "/api/processes/unknown/output" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Process not found or no output available" });
  });

  it("returns the process output when available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const response = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ processId: "p1", output: "some log output" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPollService: false });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(501);
    const body = response.json() as { error: string };
    expect(body.error).toContain("Linear polling not available");
  });

  it("returns the discovered issues on success", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPollService: true });
    mockLinearPollService!.discoverPendingIssues.mockResolvedValue([{ id: "issue-1" }]);

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ issues: [{ id: "issue-1" }] });
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPollService: true });
    mockLinearPollService!.discoverPendingIssues.mockRejectedValue(new Error("Linear API down"));

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Linear API down" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPollService: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["issue-1"] },
    });

    expect(response.statusCode).toBe(501);
    const body = response.json() as { error: string };
    expect(body.error).toContain("Linear polling not available");
  });

  it("returns 400 when issueIds is missing", async () => {
    const { app } = await buildApp({ withLinearPollService: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Required: { issueIds: string[] }" });
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const { app } = await buildApp({ withLinearPollService: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns ok with started/skipped on success", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPollService: true });
    mockLinearPollService!.startRunsForIssues.mockResolvedValue({
      started: ["issue-1"],
      skipped: ["issue-2"],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["issue-1", "issue-2"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      started: ["issue-1"],
      skipped: ["issue-2"],
    });
    expect(mockLinearPollService!.startRunsForIssues).toHaveBeenCalledWith(["issue-1", "issue-2"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPollService: true });
    mockLinearPollService!.startRunsForIssues.mockRejectedValue(new Error("DB write failed"));

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["issue-1"] },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "DB write failed" });
  });
});
