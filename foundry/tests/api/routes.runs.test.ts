import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Test description",
    linearIssueTitle: "Test issue",
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
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  };

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
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    getLinearClient: vi.fn(),
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

  it("returns { runs } from runRepo.findAll with no state filter", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([makeRun(), makeRun({ id: "run-2" })]);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    const body = res.json() as { runs: unknown[] };
    expect(body.runs).toHaveLength(2);
  });

  it("passes the state querystring through to runRepo.findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Todo,Planning" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Todo,Planning");
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

  it("returns { run, artifacts, events } when found", async () => {
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    const run = makeRun();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "artifact-1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "event-1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toHaveLength(1);
    expect(body.events).toHaveLength(1);
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

  it("returns { artifacts } when the run exists", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { artifacts: unknown[] };
    expect(body.artifacts).toHaveLength(2);
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

  it("returns { events } when the run exists", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });
});
