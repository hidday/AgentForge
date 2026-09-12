import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

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
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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

async function buildApp(overrides: {
  run?: unknown | null;
  orchestratorOverrides?: Record<string, unknown>;
} = {}) {
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(overrides.run === undefined ? makeRun() : overrides.run),
    findAll: vi.fn(),
  };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    handleCommand: vi.fn().mockResolvedValue(undefined),
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
    ...overrides.orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockRunRepo, mockOrchestrator };
}

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("sends a pause-ai command keyed by the run's linearIssueId and returns ok", async () => {
    const run = makeRun({ linearIssueId: "LIN-42" });
    const { app, mockOrchestrator } = await buildApp({ run });

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-42", { type: "pause-ai" });
  });

  it("returns 400 with the error message when handleCommand rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Cannot pause a Done run"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Cannot pause a Done run" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("sends a resume-ai command keyed by the run's linearIssueId and returns ok", async () => {
    const run = makeRun({ linearIssueId: "LIN-7" });
    const { app, mockOrchestrator } = await buildApp({ run });

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-7", { type: "resume-ai" });
  });

  it("returns 400 with the error message when handleCommand rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Run is not paused"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Run is not paused" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it.each([
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ] as const)("triggers %s -> orchestrator.%s and returns retrying:true", async (state, method) => {
    const run = makeRun({ state });
    const { app, mockOrchestrator } = await buildApp({ run });

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
    expect((mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[method]).toHaveBeenCalledWith(
      "run-1",
    );
  });

  it("returns 400 listing retryable states when the run's state is not retryable", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app } = await buildApp({ run });

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain("Retryable states:");
  });

  it("does not fail the request when the background retry trigger rejects", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockOrchestrator } = await buildApp({ run });
    mockOrchestrator.retryRun.mockRejectedValue(new Error("boom"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, retrying: true });
  });
});
