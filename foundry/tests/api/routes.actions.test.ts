import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyError, ValidationError } from "../../src/utils/errors.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
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

// Allows any pending microtasks (e.g. a fire-and-forget promise's .catch
// handler) to run before assertions / test teardown.
function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
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
    runPlanning: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    retryRun: vi.fn(),
    ...orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo };
}

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes the note, approves the plan, and kicks off execution", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "  Looks good  " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "Looks good" });
    await flushMicrotasks();
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "Looks good" });
  });

  it("treats a non-string note as absent", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: 12345 },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });

  it("treats a whitespace-only note as absent", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });

  it("truncates an overlong note to 4000 characters", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(run);

    const longNote = "x".repeat(5000);
    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: longNote },
    });

    expect(res.statusCode).toBe(200);
    const [, opts] = mockOrchestrator.approvePlan.mock.calls[0] as [string, { note: string }];
    expect(opts.note).toHaveLength(4000);
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

  it("logs (and does not throw) when the fire-and-forget runExecution rejects", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
    // No unhandled rejection should propagate; reaching here is the assertion.
  });

  it("logs (and does not throw) when the fire-and-forget runExecution rejects with a non-Error value", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
  });

  it("returns 400 with a stringified error when approvePlan throws a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/runs/:id/actions/reject-plan (non-Error rejection)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 with a stringified error when rejectPlan throws a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 immediately and triggers runManualReReview in the background", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(makeRun());

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

  it("logs when the background runManualReReview rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("re-review failed"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
  });

  it("returns 400 when runManualReReview throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp({
      runManualReReview: vi.fn().mockImplementation(() => {
        throw new Error("sync failure");
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync failure" });
  });

  it("logs with a stringified error when the background runManualReReview rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
  });

  it("returns 400 with a stringified error when runManualReReview throws a non-Error value synchronously", async () => {
    const { app } = await buildApp({
      runManualReReview: vi.fn().mockImplementation(() => {
        throw "sync non-error failure";
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync non-error failure" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 immediately and triggers runManualPlanRevision in the background", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(makeRun());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tweak step 3" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "tweak step 3",
    });
  });

  it("logs when the background runManualPlanRevision rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("revision failed"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
  });

  it("returns 400 when runManualPlanRevision throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp({
      runManualPlanRevision: vi.fn().mockImplementation(() => {
        throw new Error("sync failure");
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync failure" });
  });

  it("logs with a stringified error when the background runManualPlanRevision rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
  });

  it("returns 400 with a stringified error when runManualPlanRevision throws a non-Error value synchronously", async () => {
    const { app } = await buildApp({
      runManualPlanRevision: vi.fn().mockImplementation(() => {
        throw "sync non-error failure";
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync non-error failure" });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok + state on success", async () => {
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
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("not ready for review"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "not ready for review" });
  });

  it("returns 400 with a stringified error when approveHumanReview throws a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("sends a pause-ai command for the run's linear issue", async () => {
    const run = makeRun({ linearIssueId: "LIN-99" });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-99", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("command rejected"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "command rejected" });
  });

  it("returns 400 with a stringified error when handleCommand throws a non-Error value", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue("plain string failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("sends a resume-ai command for the run's linear issue", async () => {
    const run = makeRun({ linearIssueId: "LIN-99" });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-99", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("command rejected"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "command rejected" });
  });

  it("returns 400 with a stringified error when handleCommand throws a non-Error value", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue("plain string failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns 400 for a state that cannot be retried", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain("Retryable states:");
  });

  const cases: { state: RunState; method: string }[] = [
    { state: RunState.Todo, method: "retryRun" },
    { state: RunState.Planning, method: "runPlanning" },
    { state: RunState.PlanRevision, method: "runPlanRevision" },
    { state: RunState.PlanReview, method: "runPlanReview" },
    { state: RunState.Implementing, method: "runExecution" },
    { state: RunState.AIReview, method: "runReview" },
    { state: RunState.AddressingReview, method: "runRemediation" },
  ];

  for (const { state, method } of cases) {
    it(`triggers orchestrator.${method}() for state ${state} and returns retrying: true`, async () => {
      const run = makeRun({ state });
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      (mockOrchestrator[method] as ReturnType<typeof vi.fn>).mockResolvedValue(run);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(mockOrchestrator[method]).toHaveBeenCalledWith("run-1");
    });
  }

  it("logs (and does not throw) when the triggered background stage rejects", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry failed"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
  });

  it("logs with a stringified error when the triggered background stage rejects with a non-Error value", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue("plain string failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await flushMicrotasks();
  });
});

describe("POST /api/runs/:id/actions/reject-plan (mode validation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for an invalid mode", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
  });

  it("passes mode='fresh' through to orchestrator.rejectPlan", async () => {
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

describe("POST /api/runs/:id/actions/answer-questions (generic error branch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 with the error message when a plain Error (not Policy/Validation) is thrown", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new Error("unexpected failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "unexpected failure" });
  });

  it("returns 400 with a stringified error when a non-Error value is thrown", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("returns 400 when an answer item is null", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [null] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when an answer item has an empty answer string", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "" }] },
    });

    expect(res.statusCode).toBe(400);
  });
});

// Sanity-check that PolicyError/ValidationError are real exports used
// elsewhere (guards against the import being silently unused/misreferenced
// in this file).
describe("error class sanity", () => {
  it("PolicyError and ValidationError carry the expected status codes", () => {
    expect(new PolicyError("x").statusCode).toBe(409);
    expect(new ValidationError("x").statusCode).toBe(400);
  });
});
