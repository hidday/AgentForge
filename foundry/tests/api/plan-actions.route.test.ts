import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(state: RunState = RunState.AwaitingPlanApproval) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: "Add login",
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function buildApp(orchestratorOverrides: Record<string, unknown> = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn(), create: vi.fn() };

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
    runExecution: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    ...orchestratorOverrides,
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
  );

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo };
}

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200, sanitizes the note, and kicks off execution", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "  looks good  " },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; state: string };
    expect(body).toEqual({ ok: true, state: run.state });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("returns 400 with the error message when approvePlan rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Plan already approved"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Plan already approved" });
    expect(mockOrchestrator.runExecution).not.toHaveBeenCalled();
  });

  it("logs but does not fail the request when the fire-and-forget execution rejects", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    // allow the fire-and-forget rejection handler (which is attached via .catch)
    // to run before the test completes.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("logs but does not fail the request when the fire-and-forget execution rejects with a non-Error value", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue("plain string failure");

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("returns 400 with String(err) when approvePlan rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(42);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "42" });
  });

  it("treats a whitespace-only note as no note provided (sanitizeNote empty-after-trim branch)", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });
});

describe("POST /api/runs/:id/actions/reject-plan (mode validation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when mode is not 'iterate' or 'fresh'", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
    expect(mockOrchestrator.rejectPlan).not.toHaveBeenCalled();
  });

  it("accepts mode='fresh' and forwards it to rejectPlan", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh", context: "start over" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith(
      "run-1",
      "start over",
      "api",
      "fresh",
    );
  });

  it("returns 400 with String(err) when rejectPlan rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockRejectedValue({ reason: "db down" });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "[object Object]" });
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with { ok, runId } and fires runManualReReview with a sanitized note", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please re-check",
    });
  });

  it("returns 400 when the synchronous setup throws", async () => {
    const { app, mockOrchestrator } = await buildApp({
      runManualReReview: vi.fn(() => {
        throw new Error("cannot re-review");
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "cannot re-review" });
  });

  it("does not fail the request when the fire-and-forget re-review rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("re-review failed"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("returns 400 with String(err) when the synchronous setup throws a non-Error value", async () => {
    // Cast to `Error` so the throw type-checks (satisfying only-throw-error),
    // while the runtime value stays a plain object — exercising the
    // `err instanceof Error` false branch in the route's catch block.
    const { app } = await buildApp({
      runManualReReview: vi.fn(() => {
        throw { nonError: "cannot re-review" } as unknown as Error;
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "[object Object]" });
  });

  it("does not fail the request when the fire-and-forget re-review rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue("transient re-review failure");

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with { ok, runId } and fires runManualPlanRevision with a sanitized note", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tighten scope" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "tighten scope",
    });
  });

  it("returns 400 when the synchronous setup throws", async () => {
    const { app, mockOrchestrator } = await buildApp({
      runManualPlanRevision: vi.fn(() => {
        throw new Error("cannot revise");
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "cannot revise" });
  });

  it("does not fail the request when the fire-and-forget revision rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("revision failed"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("returns 400 with String(err) when the synchronous setup throws a non-Error value", async () => {
    const { app } = await buildApp({
      runManualPlanRevision: vi.fn(() => {
        throw { nonError: "cannot revise" } as unknown as Error;
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "[object Object]" });
  });

  it("does not fail the request when the fire-and-forget revision rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue("transient revision failure");

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with { ok, state } on success", async () => {
    const run = makeRun(RunState.Done);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 with the error message when approveHumanReview rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("not ready for review"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "not ready for review" });
  });

  it("returns 400 with String(err) when approveHumanReview rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "null" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/pause",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns 200 and calls handleCommand with pause-ai", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/pause",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
      type: "pause-ai",
    });
  });

  it("returns 400 with the error message when handleCommand rejects", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/pause",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "cannot pause" });
  });

  it("returns 400 with String(err) when handleCommand rejects with a non-Error value", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(7);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/pause",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "7" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/resume",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns 200 and calls handleCommand with resume-ai", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/resume",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
      type: "resume-ai",
    });
  });

  it("returns 400 with the error message when handleCommand rejects", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/resume",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "cannot resume" });
  });

  it("returns 400 with String(err) when handleCommand rejects with a non-Error value", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(false);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/resume",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "false" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/retry",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns 400 when the run's state is not retryable", async () => {
    const run = makeRun(RunState.Done);
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/retry",
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain("Retryable states:");
  });

  it.each([
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ] as const)(
    "returns 200 and triggers %s -> %s for a retryable state",
    async (state, method) => {
      const run = makeRun(state);
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      (mockOrchestrator[method] as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/retry",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        runId: "run-1",
        state,
        retrying: true,
      });
      expect(mockOrchestrator[method]).toHaveBeenCalledWith("run-1");
    },
  );

  it("does not fail the request when the fire-and-forget retry trigger rejects", async () => {
    const run = makeRun(RunState.Todo);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry failed"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/retry",
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("does not fail the request when the fire-and-forget retry trigger rejects with a non-Error value", async () => {
    const run = makeRun(RunState.Todo);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue("transient failure");

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/retry",
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
  });
});
