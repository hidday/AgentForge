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
    linearIssueTitle: "Add feature",
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
  runs?: unknown[];
  run?: unknown | null;
  artifacts?: unknown[];
  events?: unknown[];
} = {}) {
  const mockRunRepo = {
    findAll: vi.fn().mockResolvedValue(overrides.runs ?? []),
    findById: vi.fn().mockResolvedValue(overrides.run === undefined ? makeRun() : overrides.run),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue(overrides.artifacts ?? []),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue(overrides.events ?? []),
  };

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
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo };
}

describe("GET /api/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all runs when no state filter is given", async () => {
    const runs = [makeRun({ id: "run-1" }), makeRun({ id: "run-2" })];
    const { app, mockRunRepo } = await buildApp({ runs });

    const response = await app.inject({ method: "GET", url: "/api/runs" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ runs });
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
  });

  it("passes the state querystring through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp({ runs: [] });

    const response = await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(response.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 with an error body when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns run, artifacts and events combined when the run exists", async () => {
    const run = makeRun();
    const artifacts = [{ id: "art-1", type: "Plan" }];
    const events = [{ id: "evt-1", eventType: "PLAN_CREATED" }];
    const { app } = await buildApp({ run, artifacts, events });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { run: unknown; artifacts: unknown; events: unknown };
    expect(body.run).toMatchObject({ id: "run-1" });
    expect(body.artifacts).toEqual(artifacts);
    expect(body.events).toEqual(events);
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns the artifacts for an existing run", async () => {
    const artifacts = [{ id: "art-1", type: "Plan" }, { id: "art-2", type: "Review" }];
    const { app, mockArtifactRepo } = await buildApp({ artifacts });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ artifacts });
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns the events for an existing run", async () => {
    const events = [{ id: "evt-1", eventType: "RUN_CREATED" }];
    const { app, mockEventRepo } = await buildApp({ events });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ events });
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });
});
