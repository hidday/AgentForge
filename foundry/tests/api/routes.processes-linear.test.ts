import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(opts: {
  withLinearPollService?: boolean;
  linearPollOverrides?: Record<string, unknown>;
  activeProcesses?: unknown[];
  processOutput?: string | null;
} = {}) {
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
    getActiveProcesses: vi.fn().mockReturnValue(opts.activeProcesses ?? []),
    getProcessOutput: vi.fn().mockReturnValue(opts.processOutput ?? null),
  };

  const mockLinearPollService =
    opts.withLinearPollService === false
      ? undefined
      : {
          discoverPendingIssues: vi.fn().mockResolvedValue([]),
          startRunsForIssues: vi.fn().mockResolvedValue({ started: [], skipped: [] }),
          ...opts.linearPollOverrides,
        };

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
    const processes = [
      { id: "p1", runId: "run-1", pid: 1 },
      { id: "p2", runId: "run-2", pid: 2 },
    ];
    const { app } = await buildApp({ activeProcesses: processes });

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { processes: unknown[] }).processes).toHaveLength(2);
  });

  it("filters active processes by runId", async () => {
    const processes = [
      { id: "p1", runId: "run-1", pid: 1 },
      { id: "p2", runId: "run-2", pid: 2 },
    ];
    const { app } = await buildApp({ activeProcesses: processes });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { id: string }[] };
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].id).toBe("p2");
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when output is null (process not found)", async () => {
    const { app } = await buildApp({ processOutput: null });

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
  });

  it("returns the process output when found", async () => {
    const { app, mockProcessRunner } = await buildApp({ processOutput: "line1\nline2\n" });

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "line1\nline2\n" });
    expect(mockProcessRunner.getProcessOutput).toHaveBeenCalledWith("p1");
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPollService: false });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
  });

  it("returns issues from discoverPendingIssues", async () => {
    const issues = [{ id: "iss-1" }];
    const { app } = await buildApp({ linearPollOverrides: { discoverPendingIssues: vi.fn().mockResolvedValue(issues) } });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues });
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const { app } = await buildApp({
      linearPollOverrides: { discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear down")) },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "linear down" });
  });

  it("stringifies a non-Error rejection from discoverPendingIssues", async () => {
    const { app } = await buildApp({
      linearPollOverrides: {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        discoverPendingIssues: vi.fn().mockRejectedValue("plain string failure"),
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPollService: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when issueIds is not an array", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: "iss-1" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("starts runs for the given issueIds and returns the result", async () => {
    const { app, mockLinearPollService } = await buildApp({
      linearPollOverrides: {
        startRunsForIssues: vi.fn().mockResolvedValue({ started: ["iss-1"], skipped: ["iss-2"] }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1", "iss-2"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["iss-1"], skipped: ["iss-2"] });
    expect(
      (mockLinearPollService as { startRunsForIssues: ReturnType<typeof vi.fn> }).startRunsForIssues,
    ).toHaveBeenCalledWith(["iss-1", "iss-2"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const { app } = await buildApp({
      linearPollOverrides: { startRunsForIssues: vi.fn().mockRejectedValue(new Error("db down")) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "db down" });
  });

  it("stringifies a non-Error rejection from startRunsForIssues", async () => {
    const { app } = await buildApp({
      linearPollOverrides: {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        startRunsForIssues: vi.fn().mockRejectedValue("plain string failure"),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});
