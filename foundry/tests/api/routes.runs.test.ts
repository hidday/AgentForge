import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: "Add auth middleware",
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
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
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
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo };
}

describe("GET /api/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns runs with no state filter", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([makeRun()]);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    const body = res.json() as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
  });

  it("forwards a single ?state= filter to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Planning" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Planning");
  });

  it("forwards a multi-state comma-separated filter to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Planning,PlanReview" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Planning,PlanReview");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns run with artifacts and events on success", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { run: unknown; artifacts: unknown[]; events: unknown[] };
    expect(body.run).toMatchObject({ id: "run-1" });
    expect(body.artifacts).toEqual([{ id: "art-1" }]);
    expect(body.events).toEqual([{ id: "evt-1" }]);
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
  });

  it("returns artifacts for an existing run", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-9" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ artifacts: [{ id: "art-9" }] });
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
  });

  it("returns events for an existing run", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-5" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [{ id: "evt-5" }] });
  });
});
