import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
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

async function buildApp() {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn(),
  };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
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

  it("returns all runs when no state query param is given", async () => {
    const runs = [makeRun(), makeRun({ id: "run-2" })];
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue(runs);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    const body = res.json() as { runs: unknown[] };
    expect(body.runs).toHaveLength(2);
  });

  it("passes the state query param through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
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

  it("returns the run with its artifacts and events", async () => {
    const run = makeRun();
    const artifacts = [{ id: "art-1" }];
    const events = [{ id: "evt-1" }];
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue(artifacts);
    mockEventRepo.findByRunId.mockResolvedValue(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith("run-1");
    const body = res.json() as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual(artifacts);
    expect(body.events).toEqual(events);
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

  it("returns the run's artifacts", async () => {
    const run = makeRun();
    const artifacts = [{ id: "art-1" }, { id: "art-2" }];
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue(artifacts);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(res.json()).toEqual({ artifacts });
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

  it("returns the run's events", async () => {
    const run = makeRun();
    const events = [{ id: "evt-1" }];
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockEventRepo.findByRunId.mockResolvedValue(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(res.json()).toEqual({ events });
  });
});
