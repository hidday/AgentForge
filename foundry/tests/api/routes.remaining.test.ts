import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/issue/ENG-42",
    repo: "test/repo",
    branchName: "ai/lin-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/repo",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface BuildOpts {
  linearPollService?: Record<string, unknown> | undefined;
  orchestratorOverrides?: Record<string, unknown>;
}

function buildApp(opts: BuildOpts = {}) {
  const mockRunRepo = {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
    answerQuestions: vi.fn(),
    approvePlan: vi.fn().mockResolvedValue(makeRun({ state: RunState.Implementing })),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn().mockResolvedValue(makeRun({ state: RunState.Done })),
    handleCommand: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
    retryRun: vi.fn().mockResolvedValue(undefined),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    ...opts.orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app: FastifyInstance = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    opts.linearPollService as never,
    {},
  );

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator, mockEmitter, mockProcessRunner };
}

describe("GET /api/runs", () => {
  it("lists runs, forwarding the state query filter", async () => {
    const { app, mockRunRepo } = buildApp();
    mockRunRepo.findAll.mockResolvedValue([makeRun()]);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Todo,Planning" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Todo,Planning");
    expect(res.json().runs).toHaveLength(1);
  });
});

describe("GET /api/runs/:id", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the run with its artifacts and events", async () => {
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);
    await app.ready();

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
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the run's artifacts", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }]);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });
    expect(res.statusCode).toBe(200);
    expect(res.json().artifacts).toEqual([{ id: "a1" }]);
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the run's events", async () => {
    const { app, mockRunRepo, mockEventRepo } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([{ id: "e1" }]);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, kicks off execution, and returns the new state", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

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

  it("returns 400 when approvePlan rejects", async () => {
    const { app, mockOrchestrator } = buildApp({
      orchestratorOverrides: { approvePlan: vi.fn().mockRejectedValue(new Error("not allowed")) },
    });
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not allowed");
    expect(mockOrchestrator.runExecution).not.toHaveBeenCalled();
  });

  it("does not crash the request when the fire-and-forget execution rejects", async () => {
    const { app } = buildApp({
      orchestratorOverrides: { runExecution: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });

    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("triggers a manual re-review and returns immediately", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: "please re-check" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("triggers a manual plan revision and returns immediately", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/revise-plan" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", { note: undefined });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("approves human review and returns the new state", async () => {
    const { app } = buildApp();
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when approval fails", async () => {
    const { app } = buildApp({
      orchestratorOverrides: { approveHumanReview: vi.fn().mockRejectedValue(new Error("nope")) },
    });
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("nope");
  });
});

describe("POST /api/runs/:id/actions/pause and /resume", () => {
  it("pause returns 404 when the run is missing", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });
    expect(res.statusCode).toBe(404);
  });

  it("pause sends pause-ai via handleCommand", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("pause returns 400 when handleCommand throws", async () => {
    const { app, mockRunRepo } = buildApp({
      orchestratorOverrides: { handleCommand: vi.fn().mockRejectedValue(new Error("fail")) },
    });
    mockRunRepo.findById.mockResolvedValue(makeRun());
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });
    expect(res.statusCode).toBe(400);
  });

  it("resume returns 404 when the run is missing", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });
    expect(res.statusCode).toBe(404);
  });

  it("resume sends resume-ai via handleCommand", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run is missing", async () => {
    const { app } = buildApp();
    await app.ready();
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
  ])("triggers %s -> orchestrator.%s", async (state, method) => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state }));
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    expect(res.json().retrying).toBe(true);
    expect((mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[method]).toHaveBeenCalled();
  });

  it("returns 400 for a non-retryable state", async () => {
    const { app, mockRunRepo } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Retry is not supported");
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run is missing", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });
    expect(res.statusCode).toBe(404);
  });

  it("returns null sections when no artifacts exist", async () => {
    const { app, mockRunRepo } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
  });

  it("summarizes a plan, normalizing string and object-shaped risks", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 2,
          payloadJson: {
            summary: "do the thing",
            confidence: 0.8,
            openQuestions: [],
            steps: [{ id: "s1", title: "Step", description: "desc" }],
            risks: ["plain risk", { description: "object risk" }, { other: "x" }],
            testPlan: "run tests",
          },
        });
      }
      return Promise.resolve(null);
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.plan.version).toBe(2);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.risks).toEqual(["plain risk", "object risk", '{"other":"x"}']);
    expect(body.plan.riskCount).toBe(3);
  });

  it("includes planReview, review, and executionReport sections when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve({ version: 1, payloadJson: { verdict: "approved" } });
      if (type === "Review") return Promise.resolve({ version: 1, payloadJson: { overallVerdict: "approved" } });
      if (type === "ExecutionReport") {
        return Promise.resolve({
          version: 1,
          payloadJson: { executionVersion: 3, score: 0.75, scoreRationale: "solid" },
        });
      }
      return Promise.resolve(null);
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.planReview.version).toBe(1);
    expect(body.review.payload.overallVerdict).toBe("approved");
    expect(body.executionReport.executionVersion).toBe(3);
    expect(body.executionReport.score).toBe(0.75);
  });
});

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.json().processes).toHaveLength(2);
  });

  it("filters by runId when given", async () => {
    const { app, mockProcessRunner } = buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.json().processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns 404 when there is no output for the process", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the process output when found", async () => {
    const { app, mockProcessRunner } = buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some output");
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some output" });
  });
});

describe("GET /api/linear/pending", () => {
  it("returns 501 when Linear polling is not configured", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(501);
  });

  it("returns discovered issues when configured", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "issue-1" }]),
    };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json().issues).toEqual([{ id: "issue-1" }]);
  });

  it("returns 500 when discovery fails", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear down")),
    };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("linear down");
  });
});

describe("POST /api/linear/ingest", () => {
  it("returns 501 when Linear polling is not configured", async () => {
    const { app } = buildApp();
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: { issueIds: [] } });
    expect(res.statusCode).toBe(400);
  });

  it("starts runs for the given issue ids", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["a"], skipped: [] }),
    };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["a"], skipped: [] });
  });

  it("returns 500 when starting runs fails", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("db down")),
    };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["a"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("db down");
  });
});

describe("GET /api/events/stream (SSE)", () => {
  it("writes the SSE headers, registers a dashboard listener, and cleans up on close", () => {
    const handlers = new Map<string, (request: unknown, reply: unknown) => void>();
    const fakeApp = {
      get: (path: string, handler: (request: unknown, reply: unknown) => void) => {
        handlers.set(path, handler);
      },
      post: () => {},
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    };

    const mockOrchestrator = {
      getRunRepo: () => ({ findAll: vi.fn(), findById: vi.fn() }),
      getArtifactRepo: () => ({ findByRunId: vi.fn(), findLatestByType: vi.fn() }),
      getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
      getAgentSkillRepo: () => null,
    };
    const dashboardListeners = new Map<string, (event: unknown) => void>();
    const mockEmitter = {
      on: vi.fn((event: string, handler: (e: unknown) => void) => {
        dashboardListeners.set(event, handler);
      }),
      off: vi.fn(),
    };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      fakeApp as never,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
      undefined,
      {},
    );

    const handler = handlers.get("/api/events/stream");
    expect(handler).toBeDefined();

    const raw = { writeHead: vi.fn(), write: vi.fn() };
    const closeListeners: (() => void)[] = [];
    const fakeRequest = { raw: { on: (event: string, cb: () => void) => closeListeners.push(cb) } };
    const fakeReply = { raw };

    vi.useFakeTimers();
    handler!(fakeRequest, fakeReply);

    expect(raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

    dashboardListeners.get("dashboard")?.({ type: "run:created" });
    expect(raw.write).toHaveBeenCalledWith(expect.stringContaining('"type":"run:created"'));

    vi.advanceTimersByTime(15_000);
    expect(raw.write).toHaveBeenCalledWith(":\n\n");

    closeListeners[0]();
    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", expect.any(Function));

    vi.useRealTimers();
  });
});
