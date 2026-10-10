import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(opts: { withLinear?: boolean } = {}) {
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

  const mockLinearPollService = opts.withLinear !== false
    ? {
        discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-1" }]),
        startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
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

  return { app, mockLinearPollService };
}

describe("GET /api/linear/pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp({ withLinear: false });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
    expect((res.json() as { error: string }).error).toContain("not available");
  });

  it("returns issues when linearPollService is configured", async () => {
    const { app, mockLinearPollService } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "LIN-1" }] });
    expect(mockLinearPollService!.discoverPendingIssues).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const { app, mockLinearPollService } = await buildApp();
    mockLinearPollService!.discoverPendingIssues.mockRejectedValue(new Error("Linear API down"));

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API down" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp({ withLinear: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const { app } = await buildApp();

    const res1 = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
    expect(res1.statusCode).toBe(400);

    const res2 = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });
    expect(res2.statusCode).toBe(400);
  });

  it("starts runs for the given issueIds and returns the result", async () => {
    const { app, mockLinearPollService } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1", "LIN-2"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(mockLinearPollService!.startRunsForIssues).toHaveBeenCalledWith(["LIN-1", "LIN-2"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const { app, mockLinearPollService } = await buildApp();
    mockLinearPollService!.startRunsForIssues.mockRejectedValue(new Error("ingest failed"));

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ingest failed" });
  });
});
