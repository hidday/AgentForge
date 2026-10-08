import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(state: RunState = RunState.AwaitingPlanApproval) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

async function buildApp() {
  const runRepo = { findById: vi.fn(), findAll: vi.fn() };
  const artifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { findByRunId: vi.fn() };

  const orchestrator = {
    getRunRepo: () => runRepo,
    getArtifactRepo: () => artifactRepo,
    getEventRepo: () => eventRepo,
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
  };

  const app: FastifyInstance = Fastify({ logger: false });
  const logError = vi.spyOn(app.log, "error");
  registerApiRoutes(
    app,
    orchestrator as never,
    { on: vi.fn(), off: vi.fn() } as never,
    { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() } as never,
  );
  await app.ready();
  return { app, orchestrator, runRepo, logError };
}

/** Let fire-and-forget promise rejections reach their .catch handlers. */
const flush = () => new Promise((r) => setImmediate(r));

let current: FastifyInstance | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function setup() {
  const ctx = await buildApp();
  current = ctx.app;
  return ctx;
}

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves, kicks off execution with the trimmed note, and returns the new state", async () => {
    const { app, orchestrator } = await setup();
    orchestrator.approvePlan.mockResolvedValue(makeRun(RunState.Implementing));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   keep it small   " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(orchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "keep it small" });
    expect(orchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "keep it small" });
  });

  it("caps an over-long note at 4000 characters", async () => {
    const { app, orchestrator } = await setup();
    orchestrator.approvePlan.mockResolvedValue(makeRun(RunState.Implementing));

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "x".repeat(4001) },
    });

    const note = orchestrator.approvePlan.mock.calls[0][1].note as string;
    expect(note).toHaveLength(4000);
  });

  it.each([
    ["whitespace-only", { note: "   " }],
    ["non-string", { note: 42 }],
    ["missing", {}],
  ])("treats a %s note as no note", async (_label, payload) => {
    const { app, orchestrator } = await setup();
    orchestrator.approvePlan.mockResolvedValue(makeRun(RunState.Implementing));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(orchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });

  it("handles a request with no body at all", async () => {
    const { app, orchestrator } = await setup();
    orchestrator.approvePlan.mockResolvedValue(makeRun(RunState.Implementing));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });

    expect(res.statusCode).toBe(200);
    expect(orchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });

  it("still responds 200 and logs a truncated message when background execution fails", async () => {
    const { app, orchestrator, logError } = await setup();
    orchestrator.approvePlan.mockResolvedValue(makeRun(RunState.Implementing));
    orchestrator.runExecution.mockRejectedValue(new Error("E".repeat(300)));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });
    await flush();

    expect(res.statusCode).toBe(200);
    expect(logError).toHaveBeenCalledWith(
      { runId: "run-1", error: "E".repeat(200) },
      "Execution failed",
    );
  });

  it("logs non-Error background rejections via String()", async () => {
    const { app, orchestrator, logError } = await setup();
    orchestrator.approvePlan.mockResolvedValue(makeRun(RunState.Implementing));
    orchestrator.runExecution.mockRejectedValue("boom");

    await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });
    await flush();

    expect(logError).toHaveBeenCalledWith({ runId: "run-1", error: "boom" }, "Execution failed");
  });

  it("returns 400 with the error message when approval fails", async () => {
    const { app, orchestrator } = await setup();
    orchestrator.approvePlan.mockRejectedValue(new Error("Invalid transition"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid transition" });
    expect(orchestrator.runExecution).not.toHaveBeenCalled();
  });

  it("returns 400 with a stringified non-Error rejection", async () => {
    const { app, orchestrator } = await setup();
    orchestrator.approvePlan.mockRejectedValue("nope");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "nope" });
  });
});

describe("POST /api/runs/:id/actions/reject-plan mode validation", () => {
  it("passes mode=fresh through to the orchestrator", async () => {
    const { app, orchestrator } = await setup();
    orchestrator.rejectPlan.mockResolvedValue(makeRun(RunState.Planning));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Planning });
    expect(orchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "fresh");
  });

  it("rejects an unknown mode with 400 and does not call the orchestrator", async () => {
    const { app, orchestrator } = await setup();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "restart" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
    expect(orchestrator.rejectPlan).not.toHaveBeenCalled();
  });

  it("returns 400 with a stringified non-Error rejection", async () => {
    const { app, orchestrator } = await setup();
    orchestrator.rejectPlan.mockRejectedValue("bad state");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/reject-plan" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad state" });
  });
});

describe.each([
  {
    path: "re-review-plan",
    method: "runManualReReview" as const,
    logMsg: "Manual re-review failed",
  },
  {
    path: "revise-plan",
    method: "runManualPlanRevision" as const,
    logMsg: "Manual plan revision failed",
  },
])("POST /api/runs/:id/actions/$path", ({ path, method, logMsg }) => {
  const url = `/api/runs/run-1/actions/${path}`;

  it("starts the background job with the sanitized note and returns immediately", async () => {
    const { app, orchestrator } = await setup();

    const res = await app.inject({ method: "POST", url, payload: { note: "  focus on tests " } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(orchestrator[method]).toHaveBeenCalledWith("run-1", { note: "focus on tests" });
  });

  it("logs a truncated Error message when the background job rejects", async () => {
    const { app, orchestrator, logError } = await setup();
    orchestrator[method].mockRejectedValue(new Error("x".repeat(250)));

    const res = await app.inject({ method: "POST", url });
    await flush();

    expect(res.statusCode).toBe(200);
    expect(logError).toHaveBeenCalledWith({ runId: "run-1", error: "x".repeat(200) }, logMsg);
  });

  it("logs non-Error rejections via String()", async () => {
    const { app, orchestrator, logError } = await setup();
    orchestrator[method].mockRejectedValue(7);

    await app.inject({ method: "POST", url });
    await flush();

    expect(logError).toHaveBeenCalledWith({ runId: "run-1", error: "7" }, logMsg);
  });

  it("returns 400 when the orchestrator throws synchronously (Error)", async () => {
    const { app, orchestrator } = await setup();
    orchestrator[method].mockImplementation(() => {
      throw new Error("Run not in a reviewable state");
    });

    const res = await app.inject({ method: "POST", url });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Run not in a reviewable state" });
  });

  it("returns 400 when the orchestrator throws synchronously (non-Error)", async () => {
    const { app, orchestrator } = await setup();
    orchestrator[method].mockImplementation(() => {
      throw "sync-fail";
    });

    const res = await app.inject({ method: "POST", url });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync-fail" });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("returns the new state on success", async () => {
    const { app, orchestrator } = await setup();
    orchestrator.approveHumanReview.mockResolvedValue(makeRun(RunState.Done));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
    expect(orchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it.each([
    [new Error("Not ready for human review"), "Not ready for human review"],
    ["string-err", "string-err"],
  ])("returns 400 when approval rejects with %s", async (err, expected) => {
    const { app, orchestrator } = await setup();
    orchestrator.approveHumanReview.mockRejectedValue(err);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expected });
  });
});

describe.each([
  { action: "pause", command: "pause-ai" },
  { action: "resume", command: "resume-ai" },
])("POST /api/runs/:id/actions/$action", ({ action, command }) => {
  const url = `/api/runs/run-1/actions/${action}`;

  it(`sends the ${command} command keyed by the run's Linear issue id`, async () => {
    const { app, orchestrator, runRepo } = await setup();
    runRepo.findById.mockResolvedValue(makeRun(RunState.Implementing));
    orchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(runRepo.findById).toHaveBeenCalledWith("run-1");
    expect(orchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: command });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, orchestrator, runRepo } = await setup();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
    expect(orchestrator.handleCommand).not.toHaveBeenCalled();
  });

  it("returns 400 when the command handler throws an Error", async () => {
    const { app, orchestrator, runRepo } = await setup();
    runRepo.findById.mockResolvedValue(makeRun(RunState.Implementing));
    orchestrator.handleCommand.mockRejectedValue(new Error("cannot change state"));

    const res = await app.inject({ method: "POST", url });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot change state" });
  });

  it("returns 400 when the lookup rejects with a non-Error", async () => {
    const { app, runRepo } = await setup();
    runRepo.findById.mockRejectedValue("db down");

    const res = await app.inject({ method: "POST", url });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "db down" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, runRepo } = await setup();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it.each([
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ] as const)("in state %s triggers orchestrator.%s only", async (state, method) => {
    const { app, orchestrator, runRepo } = await setup();
    runRepo.findById.mockResolvedValue(makeRun(state));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
    expect(orchestrator[method]).toHaveBeenCalledTimes(1);
    expect(orchestrator[method]).toHaveBeenCalledWith("run-1");

    const stageMethods = [
      "retryRun",
      "runPlanning",
      "runPlanRevision",
      "runPlanReview",
      "runExecution",
      "runReview",
      "runRemediation",
    ] as const;
    for (const other of stageMethods.filter((m) => m !== method)) {
      expect(orchestrator[other]).not.toHaveBeenCalled();
    }
  });

  it.each([RunState.Done, RunState.Failed, RunState.AwaitingPlanApproval])(
    "returns 400 listing retryable states for non-retryable state %s",
    async (state) => {
      const { app, runRepo } = await setup();
      runRepo.findById.mockResolvedValue(makeRun(state));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error:
          `Retry is not supported for state "${state}". Retryable states: ` +
          "Todo, Planning, PlanRevision, PlanReview, Implementing, AIReview, AddressingReview",
      });
    },
  );

  it("logs a truncated message when the background stage fails", async () => {
    const { app, orchestrator, runRepo, logError } = await setup();
    runRepo.findById.mockResolvedValue(makeRun(RunState.AIReview));
    orchestrator.runReview.mockRejectedValue(new Error("r".repeat(201)));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });
    await flush();

    expect(res.statusCode).toBe(200);
    expect(logError).toHaveBeenCalledWith(
      { runId: "run-1", error: "r".repeat(200) },
      "Retry stage failed",
    );
  });

  it("logs non-Error stage failures via String()", async () => {
    const { app, orchestrator, runRepo, logError } = await setup();
    runRepo.findById.mockResolvedValue(makeRun(RunState.Todo));
    orchestrator.retryRun.mockRejectedValue({ toString: () => "weird" });

    await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });
    await flush();

    expect(logError).toHaveBeenCalledWith(
      { runId: "run-1", error: "weird" },
      "Retry stage failed",
    );
  });
});
