import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(state: RunState) {
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
  };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
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

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns 400 with the list of retryable states when run.state is not retryable", async () => {
    const run = makeRun(RunState.Done);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain("Retryable states:");
    expect(mockOrchestrator.retryRun).not.toHaveBeenCalled();
  });

  const cases: [RunState, string][] = [
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ];

  it.each(cases)(
    "state %s triggers orchestrator.%s and returns ok/retrying",
    async (state, methodName) => {
      const run = makeRun(state);
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; runId: string; state: string; retrying: boolean };
      expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      const method = (mockOrchestrator as unknown as Record<string, ReturnType<typeof vi.fn>>)[
        methodName
      ];
      expect(method).toHaveBeenCalledWith("run-1");
    },
  );

  it("does not fail the request when the fire-and-forget trigger rejects", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("execution crashed"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1");
  });

  it("logs a truncated message when the fire-and-forget trigger rejects with a non-Error value", async () => {
    const run = makeRun(RunState.Implementing);
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue("background boom");
    const errorSpy = vi.fn();
    app.log.error = errorSpy as never;

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errorSpy).toHaveBeenCalledWith(
      { runId: "run-1", error: "background boom" },
      "Retry stage failed",
    );
  });
});
