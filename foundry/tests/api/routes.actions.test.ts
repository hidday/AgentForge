import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(state: RunState, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

async function buildApp(orchestratorOverrides: Record<string, unknown> = {}) {
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
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
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

// Give background promises (fire-and-forget .catch chains) a tick to run.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves the plan, trims/caps the note, and kicks off execution in the background", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const longNote = `  ${"x".repeat(5000)}  `;
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: longNote },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; state: string };
    expect(body).toEqual({ ok: true, state: RunState.Implementing });

    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", {
      note: "x".repeat(4000),
    });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", {
      note: "x".repeat(4000),
    });
  });

  it("omits the note when only whitespace is provided", async () => {
    const run = makeRun(RunState.Implementing);
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

  it("returns 400 when approvePlan throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Plan not awaiting approval"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Plan not awaiting approval" });
    expect(mockOrchestrator.runExecution).not.toHaveBeenCalled();
  });

  it("logs but does not fail the request when the background execution rejects", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("execution boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await flush();
    // No unhandled rejection — the route's .catch() swallowed and logged it.
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers manual re-review in the background and returns immediately", async () => {
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

  it("logs but does not fail the request when the background re-review rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("re-review boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await flush();
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers manual plan revision in the background and returns immediately", async () => {
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

  it("logs but does not fail the request when the background revision rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("revision boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    await flush();
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves the human review and returns the new state", async () => {
    const run = makeRun(RunState.Done);
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, state: RunState.Done });
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 when approveHumanReview throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("Not ready for review"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Not ready for review" });
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

  it("sends a pause-ai command for the run's linear issue", async () => {
    const run = makeRun(RunState.Implementing, { linearIssueId: "LIN-42" });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/pause",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-42", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Cannot pause"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/pause",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cannot pause" });
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

  it("sends a resume-ai command for the run's linear issue", async () => {
    const run = makeRun(RunState.Implementing, { linearIssueId: "LIN-42" });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/resume",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-42", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Cannot resume"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/resume",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cannot resume" });
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

  it("returns 400 with the list of retryable states when the run's state is not retryable", async () => {
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
    expect(body.error).toContain("Todo");
    expect(body.error).toContain("Implementing");
  });

  it.each([
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ] as const)("retries from state %s by invoking orchestrator.%s", async (state, method) => {
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
  });

  it("logs but does not fail the request when the retried background call rejects", async () => {
    const run = makeRun(RunState.Todo);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/retry",
    });

    expect(response.statusCode).toBe(200);
    await flush();
  });
});
