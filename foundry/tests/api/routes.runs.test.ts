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
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "test-repo",
    branchName: "feature/x",
    prNumber: 42,
    state: RunState.Implementing,
    planVersion: 2,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
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

  it("returns { runs } and forwards the state querystring to findAll", async () => {
    const run = makeRun();
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([run]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Implementing" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Implementing");
  });

  it("calls findAll with undefined when no state querystring is given", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    expect(res.json()).toEqual({ runs: [] });
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

  it("returns run, artifacts and events when the run exists", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "art-1" }]);
    expect(body.events).toEqual([{ id: "evt-1" }]);
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith("run-1");
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
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns { artifacts } when the run exists", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }, { id: "art-2" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ artifacts: [{ id: "art-1" }, { id: "art-2" }] });
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
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns { events } when the run exists", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [{ id: "evt-1" }] });
  });
});

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns a trimmed summary with null sections when no artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      run: { id: string; linearIssue: { identifier: string } };
      plan: unknown;
      planReview: unknown;
      review: unknown;
      executionReport: unknown;
    };
    expect(body.run.id).toBe("run-1");
    expect(body.run.linearIssue.identifier).toBe("ENG-1");
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("includes plan/review/execution payloads, flattening risk objects and strings", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const planArtifact = {
      id: "art-plan",
      version: 3,
      payloadJson: {
        summary: "Do the thing",
        confidence: 0.9,
        openQuestions: [{ id: "q1", question: "ok?", requiredForExecution: true }],
        steps: [{ id: "s1", title: "Step 1", description: "desc" }],
        risks: ["plain risk", { description: "object risk" }, { nested: true }],
        testPlan: "run tests",
      },
    };
    const planReviewArtifact = { id: "art-pr", version: 1, payloadJson: { verdict: "approve" } };
    const reviewArtifact = { id: "art-r", version: 1, payloadJson: { verdict: "approve" } };
    const executionArtifact = {
      id: "art-e",
      version: 2,
      payloadJson: { executionVersion: 5, score: 0.8, scoreRationale: "good" },
    };

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      if (type === "PlanReview") return Promise.resolve(planReviewArtifact);
      if (type === "Review") return Promise.resolve(reviewArtifact);
      if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: { summary: string; risks: string[]; riskCount: number; stepCount: number };
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
      executionReport: { executionVersion: number; score: number; scoreRationale: string };
    };
    expect(body.plan.summary).toBe("Do the thing");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.risks).toEqual(["plain risk", "object risk", '{"nested":true}']);
    expect(body.plan.riskCount).toBe(3);
    expect(body.planReview.version).toBe(1);
    expect(body.review.version).toBe(1);
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBe(0.8);
    expect(body.executionReport.scoreRationale).toBe("good");
  });

  it("falls back to artifact version for executionVersion when payload omits it", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({ id: "art-e", version: 7, payloadJson: null });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { executionReport: { executionVersion: number; version: number } };
    expect(body.executionReport.executionVersion).toBe(7);
    expect(body.executionReport.version).toBe(7);
  });
});
