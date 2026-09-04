import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/x",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

interface BuildOpts {
  orchestratorOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown> | undefined;
  registerOptions?: Record<string, unknown>;
}

async function buildApp(opts: BuildOpts = {}) {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((params) => ({
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
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
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
    (opts.registerOptions as never) ?? {},
  );

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo, mockProcessRunner };
}

describe("GET /api/runs", () => {
  it("returns all runs with no state filter", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([makeRun()]);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    expect(res.json().runs).toHaveLength(1);
  });

  it("passes the state querystring through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Run not found");
  });

  it("returns run, artifacts, and events when found", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "a1" }]);
    expect(body.events).toEqual([{ id: "e1" }]);
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
  });

  it("returns artifacts for an existing run", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json().artifacts).toHaveLength(2);
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
  });

  it("returns events for an existing run", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([{ id: "e1" }]);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, fires runExecution in the background, and returns the new state", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "  looks good  " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("does not blow up the request when the background runExecution rejects", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    // let the fire-and-forget rejection's .catch() handler run
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("returns 400 when approvePlan throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Plan not approvable"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Plan not approvable");
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("triggers runManualReReview in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please recheck" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please recheck",
    });
  });

  it("tolerates the background promise rejecting without failing the request", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("returns 400 when triggering runManualReReview throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: {
        runManualReReview: vi.fn(() => {
          throw new Error("cannot start re-review");
        }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot start re-review");
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("triggers runManualPlanRevision in the background and returns immediately", async () => {
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

  it("tolerates the background promise rejecting without failing the request", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("returns 400 when triggering runManualPlanRevision throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: {
        runManualPlanRevision: vi.fn(() => {
          throw new Error("cannot start revision");
        }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot start revision");
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("approves the human review and returns the new state", async () => {
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
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("not ready"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not ready");
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with pause-ai for the run's linear issue", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot pause");
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with resume-ai for the run's linear issue", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot resume");
  });
});

describe("POST /api/runs/:id/actions/reject-plan (mode validation)", () => {
  it("returns 400 when mode is not iterate or fresh", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("mode must be one of");
  });

  it("accepts mode=fresh and forwards it to rejectPlan", async () => {
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

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(res.statusCode).toBe(404);
  });

  it.each([
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ] as const)("state %s triggers orchestrator.%s", async (state, method) => {
    const run = makeRun({ state });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    (mockOrchestrator[method] as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
    expect(mockOrchestrator[method]).toHaveBeenCalledWith("run-1");
  });

  it("tolerates the triggered background call rejecting", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue(new Error("boom"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("returns 400 for a state with no retry handler (e.g. Done)", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Retry is not supported for state \"Done\"");
    expect(res.json().error).toContain("Retryable states:");
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
    expect(body.run.linearIssue.identifier).toBe("LIN-1");
  });

  it("normalizes risks (plain strings, {description}, and unstringifiable objects) and maps steps", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 2,
          payloadJson: {
            summary: "A plan",
            confidence: 0.8,
            openQuestions: [{ id: "q1", question: "Which auth?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
            risks: ["Plain risk", { description: "Object risk" }, circular],
            testPlan: "run tests",
          },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.version).toBe(2);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do it" }]);
    expect(body.plan.riskCount).toBe(3);
    expect(body.plan.risks[0]).toBe("Plain risk");
    expect(body.plan.risks[1]).toBe("Object risk");
    // circular object can't be JSON.stringify'd — falls back to String(r)
    expect(body.plan.risks[2]).toBe("[object Object]");
    expect(body.plan.openQuestions).toHaveLength(1);
  });

  it("defaults steps/risks to empty when the plan payload has non-array fields", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 1,
          payloadJson: { summary: "A plan", confidence: 0.5, testPlan: "tests" },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
    expect(body.plan.openQuestions).toEqual([]);
  });

  it("includes planReview, review, and executionReport payloads with derived score fields when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") {
        return Promise.resolve({ version: 1, payloadJson: { verdict: "approved" } });
      }
      if (type === "Review") {
        return Promise.resolve({ version: 2, payloadJson: { overallVerdict: "approved" } });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          version: 3,
          payloadJson: { executionVersion: 3, score: 0.95, scoreRationale: "solid" },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 2, payload: { overallVerdict: "approved" } });
    expect(body.executionReport.executionVersion).toBe(3);
    expect(body.executionReport.score).toBe(0.95);
    expect(body.executionReport.scoreRationale).toBe("solid");
  });

  it("falls back executionVersion to the artifact version when the payload omits it", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({ version: 7, payloadJson: null });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.executionReport.executionVersion).toBe(7);
    expect(body.executionReport.score).toBeUndefined();
    expect(body.executionReport.scoreRationale).toBeUndefined();
  });
});

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { runId: "run-1", processId: "p1" },
      { runId: "run-2", processId: "p2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toHaveLength(2);
  });

  it("filters processes by runId when provided", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { runId: "run-1", processId: "p1" },
      { runId: "run-2", processId: "p2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toEqual([{ runId: "run-2", processId: "p2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns 404 when there is no output for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(404);
  });

  it("returns the process output when available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some log output" });
  });
});

describe("GET /api/linear/pending", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
  });

  it("returns the discovered issues when configured", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-5" }]),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json().issues).toEqual([{ id: "LIN-5" }]);
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear API down")),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("linear API down");
  });
});

describe("POST /api/linear/ingest", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("starts runs for the given issueIds and returns the result", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("db error")),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("db error");
  });
});

describe("POST /api/runs/:id/chat (working directory fallback)", () => {
  it("falls back to the repo root when the worktree dir is gone but the repo root still exists", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "routes-additional-chat-repo-"));
    const goneWorktree = join(repoRoot, ".worktrees", "run-1");
    const chatRun = vi.fn().mockResolvedValue({ text: "reply", durationMs: 10 });

    try {
      const { app, mockRunRepo } = await buildApp({
        registerOptions: { claudeCodeRunner: { chatRun } },
      });
      mockRunRepo.findById.mockResolvedValue(
        makeRun({ workingDirectory: goneWorktree }),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "hi" },
      });

      expect(res.statusCode).toBe(200);
      expect(chatRun).toHaveBeenCalledOnce();
      const [input] = chatRun.mock.calls[0] as [{ workingDirectory: string }];
      expect(input.workingDirectory).toBe(repoRoot);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns 422 when neither the working directory nor a worktree-stripped fallback exists", async () => {
    const chatRun = vi.fn();
    const { app, mockRunRepo } = await buildApp({
      registerOptions: { claudeCodeRunner: { chatRun } },
    });
    mockRunRepo.findById.mockResolvedValue(
      makeRun({ workingDirectory: "/definitely/does/not/exist/anywhere" }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain("Working directory not found");
    expect(chatRun).not.toHaveBeenCalled();
  });

  it("returns 422 when the working directory has no /.worktrees/ segment to strip and does not exist", async () => {
    const chatRun = vi.fn();
    const { app, mockRunRepo } = await buildApp({
      registerOptions: { claudeCodeRunner: { chatRun } },
    });
    mockRunRepo.findById.mockResolvedValue(
      makeRun({ workingDirectory: "/no/worktrees/segment/here" }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
  });
});

describe("sanitizeNote whitespace-only handling", () => {
  it("treats a whitespace-only note as no note provided", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });
});

describe("error handling: non-Error rejections are coerced to strings", () => {
  it("approve-plan surfaces a stringified non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("plain string failure");
  });

  it("reject-plan surfaces a stringified non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockRejectedValue({ oops: true });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("[object Object]");
  });

  it("approve-review surfaces a stringified non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(42);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("42");
  });

  it("pause surfaces a stringified non-Error rejection", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue("pause failed");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("pause failed");
  });

  it("resume surfaces a stringified non-Error rejection", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue("resume failed");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("resume failed");
  });

  it("re-review-plan surfaces a stringified non-Error synchronous throw", async () => {
    const { app } = await buildApp({
      orchestratorOverrides: {
        runManualReReview: vi.fn(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw "sync failure";
        }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("sync failure");
  });

  it("revise-plan surfaces a stringified non-Error synchronous throw", async () => {
    const { app } = await buildApp({
      orchestratorOverrides: {
        runManualPlanRevision: vi.fn(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw "sync failure";
        }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("sync failure");
  });

  it("answer-questions surfaces a stringified non-Error rejection when it is neither PolicyError nor ValidationError", async () => {
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: { answerQuestions: vi.fn() },
    });
    mockOrchestrator.answerQuestions.mockRejectedValue("weird failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("weird failure");
  });

  it("chat surfaces a 500 when chatRun rejects with a non-Error value", async () => {
    const chatRun = vi.fn().mockRejectedValue("subprocess died");
    const { app, mockRunRepo } = await buildApp({
      registerOptions: { claudeCodeRunner: { chatRun } },
    });
    mockRunRepo.findById.mockResolvedValue(makeRun({ workingDirectory: "/tmp" }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Chat request failed");
  });

  it("linear/pending surfaces a stringified non-Error rejection", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue("pending failed"),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("pending failed");
  });

  it("linear/ingest surfaces a stringified non-Error rejection", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockRejectedValue("ingest failed"),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("ingest failed");
  });
});
