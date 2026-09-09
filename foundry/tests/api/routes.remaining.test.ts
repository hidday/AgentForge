import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/x",
    repo: "org/repo",
    branchName: "feature/x",
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
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

interface BuildAppOpts {
  orchestratorOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown> | undefined;
  options?: Record<string, unknown>;
}

async function buildApp(opts: BuildAppOpts = {}) {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  };

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
    runPlanning: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    retryRun: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
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
    opts.options as never,
  );

  await app.ready();
  return {
    app,
    mockRunRepo,
    mockArtifactRepo,
    mockEventRepo,
    mockOrchestrator,
    mockEmitter,
    mockProcessRunner,
  };
}

// Let any pending fire-and-forget promises (`.catch(...)` chains scheduled by
// the route handlers) flush before assertions that depend on them.
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("GET /api/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { runs } from runRepo.findAll with no state filter", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([makeRun()]);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    const body = res.json() as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
  });

  it("passes the state querystring through to runRepo.findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns { run, artifacts, events } when the run exists", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "a1" }]);
    expect(body.events).toEqual([{ id: "e1" }]);
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });
    expect(res.statusCode).toBe(404);
  });

  it("returns { artifacts } when the run exists", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { artifacts: unknown[] }).artifacts).toHaveLength(2);
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });
    expect(res.statusCode).toBe(404);
  });

  it("returns { events } when the run exists", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { events: unknown[] }).events).toEqual([{ id: "e1" }]);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves the plan, kicks off execution, and returns { ok, state }", async () => {
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

  it("treats a non-string / empty note as no note (sanitizeNote -> undefined)", async () => {
    const run = makeRun();
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

  it("truncates a note longer than 4000 characters", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const longNote = "x".repeat(5000);
    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: longNote },
    });

    const [, args] = mockOrchestrator.approvePlan.mock.calls[0] as [string, { note: string }];
    expect(args.note).toHaveLength(4000);
  });

  it("returns 400 when approvePlan throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Cannot approve from this state"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Cannot approve from this state" });
  });

  it("logs but does not fail the request when the fire-and-forget runExecution rejects", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("execution blew up"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(200);
    await flush();
    // No assertion on logger internals (fastify logger disabled) -- the key
    // behavior under test is that the rejection does not crash/hang the route.
  });

  it("logs but does not fail the request when runExecution rejects with a non-Error value", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    // eslint-disable-next-line prefer-promise-reject-errors
    mockOrchestrator.runExecution.mockRejectedValue("plain string rejection");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(200);
    await flush();
  });

  it("returns 400 with a stringified message when approvePlan rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    // eslint-disable-next-line prefer-promise-reject-errors
    mockOrchestrator.approvePlan.mockRejectedValue("plain rejection reason");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain rejection reason" });
  });
});

describe("POST /api/runs/:id/actions/reject-plan (mode validation)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when mode is not 'iterate' or 'fresh'", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus-mode" },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("mode must be one of");
  });

  it("accepts mode='fresh' and forwards it to orchestrator.rejectPlan", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh", context: "start over" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith(
      "run-1",
      "start over",
      "api",
      "fresh",
    );
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("kicks off a manual re-review and returns { ok, runId } immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "double check the risk section" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "double check the risk section",
    });
  });

  it("logs but does not fail the request when the background re-review rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("re-review failed"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(200);
    await flush();
  });

  it("returns 400 when triggering the re-review throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("cannot start re-review");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot start re-review" });
  });

  it("logs but does not fail the request when the background re-review rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    // eslint-disable-next-line prefer-promise-reject-errors
    mockOrchestrator.runManualReReview.mockRejectedValue("plain re-review failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(200);
    await flush();
  });

  it("returns 400 with a stringified message when triggering re-review throws a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "plain synchronous failure";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain synchronous failure" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("kicks off a manual plan revision and returns { ok, runId } immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tighten scope" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "tighten scope",
    });
  });

  it("logs but does not fail the request when the background revision rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("revision failed"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(200);
    await flush();
  });

  it("returns 400 when triggering the revision throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("cannot start revision");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot start revision" });
  });

  it("logs but does not fail the request when the background revision rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    // eslint-disable-next-line prefer-promise-reject-errors
    mockOrchestrator.runManualPlanRevision.mockRejectedValue("plain revision failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(200);
    await flush();
  });

  it("returns 400 with a stringified message when triggering the revision throws a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "plain synchronous revision failure";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain synchronous revision failure" });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { ok, state } on success", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 when approveHumanReview throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("wrong state"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "wrong state" });
  });

  it("returns 400 with a stringified message when approveHumanReview rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    // eslint-disable-next-line prefer-promise-reject-errors
    mockOrchestrator.approveHumanReview.mockRejectedValue("plain rejection");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain rejection" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });
    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with pause-ai and returns ok:true", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot pause" });
  });

  it("returns 400 with a stringified message when handleCommand rejects with a non-Error value", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    // eslint-disable-next-line prefer-promise-reject-errors
    mockOrchestrator.handleCommand.mockRejectedValue("plain pause failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain pause failure" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });
    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with resume-ai and returns ok:true", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot resume" });
  });

  it("returns 400 with a stringified message when handleCommand rejects with a non-Error value", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    // eslint-disable-next-line prefer-promise-reject-errors
    mockOrchestrator.handleCommand.mockRejectedValue("plain resume failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain resume failure" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => vi.clearAllMocks());

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
  ] as const)("retries from state %s by calling orchestrator.%s", async (state, method) => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state }));
    (mockOrchestrator[method] as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; runId: string; state: string; retrying: boolean };
    expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
    expect(mockOrchestrator[method]).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 listing retryable states when the run's state is not retryable", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain("Retryable states:");
  });

  it("logs but does not fail the request when the background retry trigger rejects", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry blew up"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await flush();
  });

  it("logs but does not fail the request when the background retry trigger rejects with a non-Error value", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    // eslint-disable-next-line prefer-promise-reject-errors
    mockOrchestrator.retryRun.mockRejectedValue("plain retry failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await flush();
  });
});

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });
    expect(res.statusCode).toBe(404);
  });

  it("returns plan:null / planReview:null / review:null / executionReport:null when no artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: unknown;
      planReview: unknown;
      review: unknown;
      executionReport: unknown;
      run: { id: string; linearIssue: { identifier: string } };
    };
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
    expect(body.run.linearIssue.identifier).toBe("ENG-1");
  });

  it("maps a full plan (string risks, object risks with description, steps, open questions)", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(
      async (_runId: string, type: string) => {
        if (type === "Plan") {
          return {
            version: 2,
            payloadJson: {
              summary: "Add feature X",
              confidence: 0.9,
              openQuestions: [{ id: "q1", question: "Which API?", requiredForExecution: true }],
              steps: [{ id: "s1", title: "Step 1", description: "Do the thing", extra: "ignored" }],
              risks: ["plain string risk", { description: "object risk" }, { weird: "shape" }],
              testPlan: "run unit tests",
            },
          };
        }
        return null;
      },
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: {
        version: number;
        summary: string;
        confidence: number;
        stepCount: number;
        steps: { id: string; title: string; description: string }[];
        risks: string[];
        riskCount: number;
        testPlan: string;
        openQuestions: unknown[];
      };
    };
    expect(body.plan.version).toBe(2);
    expect(body.plan.summary).toBe("Add feature X");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do the thing" }]);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ weird: "shape" }));
    expect(body.plan.riskCount).toBe(3);
    expect(body.plan.openQuestions).toHaveLength(1);
  });

  it("handles a risk entry that cannot be JSON.stringify'd by falling back to String(r)", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(
      async (_runId: string, type: string) => {
        if (type === "Plan") {
          return {
            version: 1,
            payloadJson: { risks: [circular] },
          };
        }
        return null;
      },
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks[0]).toBe(String(circular));
  });

  it("treats a non-array risks field as an empty risk list", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(
      async (_runId: string, type: string) => {
        if (type === "Plan") return { version: 1, payloadJson: { risks: "not-an-array" } };
        return null;
      },
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as { plan: { risks: string[]; riskCount: number } };
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads verbatim when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(
      async (_runId: string, type: string) => {
        if (type === "PlanReview") return { version: 3, payloadJson: { verdict: "approve" } };
        if (type === "Review") return { version: 4, payloadJson: { verdict: "changes-requested" } };
        return null;
      },
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as {
      planReview: { version: number; payload: { verdict: string } };
      review: { version: number; payload: { verdict: string } };
    };
    expect(body.planReview).toEqual({ version: 3, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 4, payload: { verdict: "changes-requested" } });
  });

  it("maps executionReport using payload.executionVersion/score when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(
      async (_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return {
            version: 5,
            payloadJson: { executionVersion: 9, score: 0.8, scoreRationale: "solid" },
          };
        }
        return null;
      },
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as {
      executionReport: {
        version: number;
        executionVersion: number;
        score: number;
        scoreRationale: string;
      };
    };
    expect(body.executionReport).toMatchObject({
      version: 5,
      executionVersion: 9,
      score: 0.8,
      scoreRationale: "solid",
    });
  });

  it("falls back executionVersion to the artifact version when payload lacks one", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(
      async (_runId: string, type: string) => {
        if (type === "ExecutionReport") return { version: 6, payloadJson: null };
        return null;
      },
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(6);
  });
});

describe("POST /api/runs/:id/actions/request-human (remaining branches)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("uses the default debounceHours (6) and default uiBaseUrl when options are omitted", async () => {
    const run = makeRun({ linearIssueIdentifier: null });
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockEventRepo.findByRunId.mockResolvedValue([]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "manual flag, no notification service configured" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; notified: { slack: boolean; email: boolean } };
    expect(body.ok).toBe(true);
    expect(body.notified).toEqual({ slack: false, email: false });

    const [eventArgs] = mockEventRepo.create.mock.calls[0] as [{ payloadJson: { runUrl: string } }];
    expect(eventArgs.payloadJson.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("does not debounce when an existing event has a different eventType", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([
      { eventType: "SOME_OTHER_EVENT", createdAt: new Date(), payloadJson: { reason: "other" } },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hello" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { debounced: boolean }).debounced).toBe(false);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { processes: unknown[] }).processes).toHaveLength(2);
  });

  it("filters active processes by runId querystring", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { processes: { id: string }[] };
    expect(body.processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when there is no output for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });
    expect(res.statusCode).toBe(404);
  });

  it("returns { processId, output } when output exists", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some log output" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(501);
  });

  it("returns { issues } on success", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-1" }]),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "LIN-1" }] });
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API down")),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API down" });
  });

  it("returns 500 with a stringified message when discoverPendingIssues rejects with a non-Error value", async () => {
    const linearPollService = {
      // eslint-disable-next-line prefer-promise-reject-errors
      discoverPendingIssues: vi.fn().mockRejectedValue("plain linear failure"),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain linear failure" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("returns { ok, ...result } on success", async () => {
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
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("db unavailable")),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "db unavailable" });
  });

  it("returns 500 with a stringified message when startRunsForIssues rejects with a non-Error value", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      // eslint-disable-next-line prefer-promise-reject-errors
      startRunsForIssues: vi.fn().mockRejectedValue("plain ingest failure"),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain ingest failure" });
  });
});
