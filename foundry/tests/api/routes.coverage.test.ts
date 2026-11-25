import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/x",
    repo: "test-repo",
    branchName: "main",
    prNumber: 7,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface BuildOpts {
  orchestratorOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown>;
  routeOptions?: Record<string, unknown>;
}

async function buildApp(opts: BuildOpts = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => ({
      id: `artifact-${Math.random()}`,
      ...params,
      createdAt: new Date(),
    })),
  };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]) };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    runPlanning: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    retryRun: vi.fn(),
    ...opts.orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };

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
    opts.linearPollService as never,
    opts.routeOptions as never,
  );

  await app.ready();
  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator, mockProcessRunner };
}

describe("GET /api/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all runs with no state filter", async () => {
    const { app, mockRunRepo } = await buildApp();
    const runs = [makeRun()];
    mockRunRepo.findAll.mockResolvedValue(runs);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    const body = res.json() as { runs: { id: string }[] };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe(runs[0].id);
  });

  it("passes the state query param through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns run with artifacts and events when found", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "art-1" }]);
    expect(body.events).toEqual([{ id: "evt-1" }]);
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
  });

  it("returns artifacts for the run", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ artifacts: [{ id: "art-1" }] });
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
  });

  it("returns events for the run", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [{ id: "evt-1" }] });
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves the plan, kicks off execution, and returns the run state", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "looks good" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("logs but does not fail the request when runExecution rejects asynchronously", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));
    const logErrorSpy = vi.spyOn(app.log, "error");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    // allow the fire-and-forget rejection handler (the .catch chain) to run
    await new Promise((r) => setTimeout(r, 0));
    expect(logErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "boom" }),
      "Execution failed",
    );
  });

  it("returns 400 when approvePlan throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Plan not awaiting approval"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Plan not awaiting approval" });
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("triggers manual re-review and returns ok immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please re-check",
    });
  });

  it("returns 400 if sanitizeNote/trigger throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("sync failure");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync failure" });
  });

  it("logs but does not fail the request when runManualReReview rejects asynchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("async re-review failure"));
    const logErrorSpy = vi.spyOn(app.log, "error");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(logErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "async re-review failure" }),
      "Manual re-review failed",
    );
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("triggers manual plan revision and returns ok immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tweak step 2" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "tweak step 2",
    });
  });

  it("returns 400 if the trigger throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("sync failure");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync failure" });
  });

  it("logs but does not fail the request when runManualPlanRevision rejects asynchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("async revise failure"));
    const logErrorSpy = vi.spyOn(app.log, "error");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(logErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "async revise failure" }),
      "Manual plan revision failed",
    );
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok and state on success", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when approveHumanReview throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("Not ready for review"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Not ready for review" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with pause-ai and returns ok", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
      type: "pause-ai",
    });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot pause" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with resume-ai and returns ok", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
      type: "resume-ai",
    });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot resume" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(res.statusCode).toBe(404);
  });

  const retryCases: { state: RunState; method: string }[] = [
    { state: RunState.Todo, method: "retryRun" },
    { state: RunState.Planning, method: "runPlanning" },
    { state: RunState.PlanRevision, method: "runPlanRevision" },
    { state: RunState.PlanReview, method: "runPlanReview" },
    { state: RunState.Implementing, method: "runExecution" },
    { state: RunState.AIReview, method: "runReview" },
    { state: RunState.AddressingReview, method: "runRemediation" },
  ];

  for (const { state, method } of retryCases) {
    it(`triggers ${method} for state ${state} and returns ok`, async () => {
      const run = makeRun({ state });
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      (mockOrchestrator[method] as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(mockOrchestrator[method]).toHaveBeenCalledWith("run-1");
    });
  }

  it("returns 400 for a non-retryable state", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
  });

  it("logs but does not fail the request when the retry trigger rejects asynchronously", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry failed"));
    const logErrorSpy = vi.spyOn(app.log, "error");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(logErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "retry failed" }),
      "Retry stage failed",
    );
  });
});

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns a summary with plan=null and executionReport=null when no artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("maps plan risks of mixed shapes (string, object with description, plain object) and includes execution report", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 2,
          payloadJson: {
            summary: "do the thing",
            confidence: 0.9,
            openQuestions: [{ id: "q1", question: "why?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Step 1", description: "do it" }],
            risks: ["plain string risk", { description: "object risk" }, { weird: "shape" }],
            testPlan: "run tests",
          },
        });
      }
      if (type === "PlanReview") {
        return Promise.resolve({ version: 1, payloadJson: { approved: true } });
      }
      if (type === "Review") {
        return Promise.resolve({ version: 1, payloadJson: { verdict: "pass" } });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          version: 3,
          payloadJson: { executionVersion: 3, score: 0.8, scoreRationale: "solid" },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.summary).toBe("do the thing");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.risks).toEqual([
      "plain string risk",
      "object risk",
      JSON.stringify({ weird: "shape" }),
    ]);
    expect(body.plan.riskCount).toBe(3);
    expect(body.planReview).toEqual({ version: 1, payload: { approved: true } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "pass" } });
    expect(body.executionReport).toEqual({
      version: 3,
      executionVersion: 3,
      score: 0.8,
      scoreRationale: "solid",
      payload: { executionVersion: 3, score: 0.8, scoreRationale: "solid" },
    });
  });

  it("falls back to an empty steps array when plan.steps is not an array, and to String(r) when a risk can't be JSON.stringify'd", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: { self?: unknown } = {};
    circular.self = circular;

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 1,
          payloadJson: {
            summary: "no steps here",
            confidence: 0.5,
            // steps intentionally omitted (not an array)
            risks: [circular],
          },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.risks).toEqual([String(circular)]);
  });

  it("falls back to artifact version for executionVersion when payload omits it", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({ version: 5, payloadJson: {} });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBeUndefined();
  });
});

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes with no runId filter", async () => {
    const { app, mockProcessRunner } = await buildApp();
    const processes = [
      { id: "p1", runId: "run-1", pid: 1, command: "x", stage: "s", runtime: "r", startedAt: "", elapsedMs: 0 },
      { id: "p2", runId: "run-2", pid: 2, command: "y", stage: "s", runtime: "r", startedAt: "", elapsedMs: 0 },
    ];
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes });
  });

  it("filters processes by runId query param", async () => {
    const { app, mockProcessRunner } = await buildApp();
    const processes = [
      { id: "p1", runId: "run-1", pid: 1, command: "x", stage: "s", runtime: "r", startedAt: "", elapsedMs: 0 },
      { id: "p2", runId: "run-2", pid: 2, command: "y", stage: "s", runtime: "r", startedAt: "", elapsedMs: 0 },
    ];
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes: [processes[1]] });
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when output is null", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
  });

  it("returns the process output when found", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some log output" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
  });

  it("returns the discovered issues on success", async () => {
    const mockLinearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "iss-1" }]),
    };
    const { app } = await buildApp({ linearPollService: mockLinearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "iss-1" }] });
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const mockLinearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear api down")),
    };
    const { app } = await buildApp({ linearPollService: mockLinearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "linear api down" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when linearPollService is not configured", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const mockLinearPollService = { startRunsForIssues: vi.fn() };
    const { app } = await buildApp({ linearPollService: mockLinearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(mockLinearPollService.startRunsForIssues).not.toHaveBeenCalled();
  });

  it("starts runs for the given issue ids on success", async () => {
    const mockLinearPollService = {
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["a", "b"] }),
    };
    const { app } = await buildApp({ linearPollService: mockLinearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a", "b"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["a", "b"] });
    expect(mockLinearPollService.startRunsForIssues).toHaveBeenCalledWith(["a", "b"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const mockLinearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("ingest failed")),
    };
    const { app } = await buildApp({ linearPollService: mockLinearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ingest failed" });
  });
});

// The SSE route (`GET /api/events/stream`) writes directly to the raw HTTP
// response and never calls reply.send()/reply.raw.end(). Fastify's `inject()`
// only resolves once the response finishes, so a genuine long-lived SSE
// connection never resolves through inject(). To test its real behavior
// (headers, heartbeat, dashboard event forwarding, and cleanup on close)
// deterministically, we capture the route handler via a minimal fake Fastify
// app and invoke it directly with fake request/reply objects.
describe("GET /api/events/stream", () => {
  function makeFakeApp() {
    const routes = new Map<string, (request: unknown, reply: unknown) => unknown>();
    const fakeApp = {
      get: vi.fn((path: string, handler: (request: unknown, reply: unknown) => unknown) => {
        routes.set(`GET ${path}`, handler);
      }),
      post: vi.fn(),
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    };
    return { fakeApp, routes };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers, forwards dashboard events, sends heartbeats, and cleans up on close", async () => {
    const { fakeApp, routes } = makeFakeApp();
    const mockEmitter = new EventEmitter();
    const onSpy = vi.spyOn(mockEmitter, "on");
    const offSpy = vi.spyOn(mockEmitter, "off");

    const mockOrchestrator = {
      getRunRepo: () => ({}),
      getArtifactRepo: () => ({}),
      getEventRepo: () => ({}),
    };
    const mockProcessRunner = {};

    registerApiRoutes(
      fakeApp as never,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = routes.get("GET /api/events/stream");
    expect(handler).toBeDefined();

    const written: string[] = [];
    const reply = {
      raw: {
        writeHead: vi.fn(),
        write: vi.fn((chunk: string) => {
          written.push(chunk);
        }),
      },
    };
    const request = { raw: new EventEmitter() };

    handler!(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(written[0]).toBe(":\n\n");
    expect(onSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));

    // A dashboard event is forwarded as an SSE `data:` line.
    const event = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "test-repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    mockEmitter.emit("dashboard", event);
    expect(written[written.length - 1]).toBe(`data: ${JSON.stringify(event)}\n\n`);

    // Heartbeats fire every 15s.
    const beforeHeartbeat = written.length;
    vi.advanceTimersByTime(15_000);
    expect(written.length).toBeGreaterThan(beforeHeartbeat);
    expect(written[written.length - 1]).toBe(":\n\n");

    // On close, the heartbeat interval is cleared and the listener removed.
    (request.raw as EventEmitter).emit("close");
    expect(offSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));

    const afterCloseLength = written.length;
    vi.advanceTimersByTime(60_000);
    expect(written.length).toBe(afterCloseLength);

    mockEmitter.emit("dashboard", event);
    expect(written.length).toBe(afterCloseLength);
  });
});

describe("POST /api/runs/:id/chat — workingDirectory fallback", () => {
  let baseDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    baseDir = mkdtempSync(join(tmpdir(), "routes-coverage-worktree-"));
  });

  afterEach(() => {
    try {
      rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("falls back to the main repo directory when the worktree path is gone but the base repo still exists", async () => {
    const run = makeRun({ workingDirectory: join(baseDir, ".worktrees", "run-1") });
    const mockClaudeCodeRunner = {
      chatRun: vi.fn().mockResolvedValue({ text: "fallback reply", durationMs: 42 }),
    };
    const { app, mockRunRepo } = await buildApp({
      routeOptions: { claudeCodeRunner: mockClaudeCodeRunner },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockClaudeCodeRunner.chatRun).toHaveBeenCalledOnce();
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(baseDir);
  });

  it("returns 422 when neither the worktree path nor the fallback base directory exists", async () => {
    const run = makeRun({
      workingDirectory: join(baseDir, "does-not-exist", ".worktrees", "run-1"),
    });
    const mockClaudeCodeRunner = { chatRun: vi.fn() };
    const { app, mockRunRepo } = await buildApp({
      routeOptions: { claudeCodeRunner: mockClaudeCodeRunner },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 422 when workingDirectory is missing and has no /.worktrees/ segment to fall back from", async () => {
    const run = makeRun({ workingDirectory: join(baseDir, "totally-missing-dir") });
    const mockClaudeCodeRunner = { chatRun: vi.fn() };
    const { app, mockRunRepo } = await buildApp({
      routeOptions: { claudeCodeRunner: mockClaudeCodeRunner },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when mode is not one of 'iterate' or 'fresh'", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "not-a-real-mode" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
    expect(mockOrchestrator.rejectPlan).not.toHaveBeenCalled();
  });

  it("passes an explicit mode of 'fresh' through to rejectPlan", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "fresh");
  });
});
