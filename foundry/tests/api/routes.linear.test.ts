import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";

async function buildApp(linearPollService?: Record<string, unknown>) {
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

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    linearPollService as never,
  );
  await app.ready();
  return { app };
}

function makeLinearPollService() {
  return {
    discoverPendingIssues: vi.fn(),
    startRunsForIssues: vi.fn(),
  };
}

describe("GET /api/linear/pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp(undefined);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
    const body = res.json() as { error: string };
    expect(body.error).toContain("Linear polling not available");
  });

  it("returns discovered issues when configured", async () => {
    const linearPollService = makeLinearPollService();
    const issues = [{ id: "ENG-1", title: "Fix bug" }];
    linearPollService.discoverPendingIssues.mockResolvedValue(issues);
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues });
    expect(linearPollService.discoverPendingIssues).toHaveBeenCalledTimes(1);
  });

  it("returns 500 with the error message when discovery throws", async () => {
    const linearPollService = makeLinearPollService();
    linearPollService.discoverPendingIssues.mockRejectedValue(new Error("Linear API down"));
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API down" });
  });

  it("returns 500 with a stringified message when discovery rejects with a non-Error value", async () => {
    const linearPollService = makeLinearPollService();
    linearPollService.discoverPendingIssues.mockRejectedValue("plain rejection");
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain rejection" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["ENG-1"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const linearPollService = makeLinearPollService();
    const { app } = await buildApp(linearPollService);

    const res1 = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
    expect(res1.statusCode).toBe(400);

    const res2 = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });
    expect(res2.statusCode).toBe(400);
    expect(linearPollService.startRunsForIssues).not.toHaveBeenCalled();
  });

  it("starts runs for the given issue ids and returns the result", async () => {
    const linearPollService = makeLinearPollService();
    linearPollService.startRunsForIssues.mockResolvedValue({
      started: ["ENG-1"],
      skipped: ["ENG-2"],
    });
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["ENG-1", "ENG-2"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["ENG-1"], skipped: ["ENG-2"] });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["ENG-1", "ENG-2"]);
  });

  it("returns 500 with the error message when starting runs throws", async () => {
    const linearPollService = makeLinearPollService();
    linearPollService.startRunsForIssues.mockRejectedValue(new Error("db unavailable"));
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["ENG-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "db unavailable" });
  });

  it("returns 500 with a stringified message when starting runs rejects with a non-Error value", async () => {
    const linearPollService = makeLinearPollService();
    linearPollService.startRunsForIssues.mockRejectedValue("plain rejection");
    const { app } = await buildApp(linearPollService);

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["ENG-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain rejection" });
  });
});
