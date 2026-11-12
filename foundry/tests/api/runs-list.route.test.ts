import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
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

async function buildApp() {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
  };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
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
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
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
  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo };
}

describe("GET /api/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { runs } calling findAll with no state filter", async () => {
    const { app, mockRunRepo } = await buildApp();
    const runs = [makeRun(), makeRun({ id: "run-2" })];
    mockRunRepo.findAll.mockResolvedValue(runs);

    const response = await app.inject({ method: "GET", url: "/api/runs" });

    expect(response.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    const body = response.json() as { runs: unknown[] };
    expect(body.runs).toHaveLength(2);
  });

  it("forwards the state querystring to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const response = await app.inject({
      method: "GET",
      url: "/api/runs?state=Done",
    });

    expect(response.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns run, artifacts, and events when found", async () => {
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    const run = makeRun();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "artifact-1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "event-1" }]);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "artifact-1" }]);
    expect(body.events).toEqual([{ id: "event-1" }]);
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: "GET",
      url: "/api/runs/missing/artifacts",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns artifacts for an existing run", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "artifact-1", type: "Plan" }]);

    const response = await app.inject({
      method: "GET",
      url: "/api/runs/run-1/artifacts",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ artifacts: [{ id: "artifact-1", type: "Plan" }] });
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: "GET",
      url: "/api/runs/missing/events",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns events for an existing run", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "event-1", eventType: "PLAN_CREATED" }]);

    const response = await app.inject({
      method: "GET",
      url: "/api/runs/run-1/events",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ events: [{ id: "event-1", eventType: "PLAN_CREATED" }] });
  });
});
