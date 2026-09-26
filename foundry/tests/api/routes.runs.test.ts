import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
    linearIssueUrl: null,
    repo: "test/repo",
    branchName: "main",
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

async function buildApp(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator };
}

describe("GET /api/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { runs } from runRepo.findAll with no state filter", async () => {
    const { app, mockRunRepo } = await buildApp();
    const runs = [makeRun(), makeRun({ id: "run-2" })];
    mockRunRepo.findAll.mockResolvedValue(runs);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    const body = res.json() as { runs: unknown[] };
    expect(body.runs).toHaveLength(2);
  });

  it("passes the state querystring through to runRepo.findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Implementing" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Implementing");
    expect(res.json()).toEqual({ runs: [] });
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns { run, artifacts, events } for an existing run", async () => {
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
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns { artifacts } for an existing run", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1", type: "Plan" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ artifacts: [{ id: "art-1", type: "Plan" }] });
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns { events } for an existing run", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1", eventType: "PLAN_CREATED" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [{ id: "evt-1", eventType: "PLAN_CREATED" }] });
  });
});

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      run: { id: string };
      plan: unknown;
      planReview: unknown;
      review: unknown;
      executionReport: unknown;
    };
    expect(body.run.id).toBe("run-1");
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("maps plan risks: string, object-with-description, plain-object (JSON.stringify), and circular (String fallback)", async () => {
    const run = makeRun();
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    const planArtifact = {
      id: "art-plan",
      runId: run.id,
      type: "Plan",
      version: 5,
      payloadJson: {
        summary: "Do the thing",
        confidence: 0.9,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
        steps: [{ id: "s1", title: "Step 1", description: "Do step 1" }],
        risks: ["plain string risk", { description: "object risk" }, { code: 1 }, circular],
        testPlan: "Run the tests",
      },
      rawText: "",
      createdAt: new Date(),
    };

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? planArtifact : null),
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: {
        version: number;
        summary: string;
        confidence: number;
        stepCount: number;
        steps: { id: string; title: string; description: string }[];
        risks: string[];
        riskCount: number;
        testPlan: string;
      };
    };
    expect(body.plan.version).toBe(5);
    expect(body.plan.summary).toBe("Do the thing");
    expect(body.plan.confidence).toBe(0.9);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do step 1" }]);
    expect(body.plan.riskCount).toBe(4);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ code: 1 }));
    // Circular object: JSON.stringify throws, falls back to String(r) => "[object Object]"
    expect(body.plan.risks[3]).toBe(String(circular));
    expect(body.plan.testPlan).toBe("Run the tests");
  });

  it("handles a plan artifact with non-array steps/risks gracefully", async () => {
    const run = makeRun();
    const planArtifact = {
      id: "art-plan",
      runId: run.id,
      type: "Plan",
      version: 1,
      payloadJson: { summary: "No steps yet" },
      rawText: "",
      createdAt: new Date(),
    };

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? planArtifact : null),
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { stepCount: number; steps: unknown[]; risks: unknown[]; riskCount: number } };
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads when present", async () => {
    const run = makeRun();
    const planReviewArtifact = {
      id: "art-pr",
      runId: run.id,
      type: "PlanReview",
      version: 2,
      payloadJson: { summary: "Looks good", findings: [] },
      rawText: "",
      createdAt: new Date(),
    };
    const reviewArtifact = {
      id: "art-r",
      runId: run.id,
      type: "Review",
      version: 3,
      payloadJson: { verdict: "approve" },
      rawText: "",
      createdAt: new Date(),
    };

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve(planReviewArtifact);
      if (type === "Review") return Promise.resolve(reviewArtifact);
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 2, payload: { summary: "Looks good", findings: [] } });
    expect(body.review).toEqual({ version: 3, payload: { verdict: "approve" } });
  });

  it("falls back executionVersion to artifact.version and includes score fields", async () => {
    const run = makeRun();
    const executionArtifact = {
      id: "art-exec",
      runId: run.id,
      type: "ExecutionReport",
      version: 7,
      payloadJson: { score: 0.85, scoreRationale: "Solid coverage" },
      rawText: "",
      createdAt: new Date(),
    };

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "ExecutionReport" ? executionArtifact : null),
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score: number; scoreRationale: string };
    };
    expect(body.executionReport.version).toBe(7);
    expect(body.executionReport.executionVersion).toBe(7);
    expect(body.executionReport.score).toBe(0.85);
    expect(body.executionReport.scoreRationale).toBe("Solid coverage");
  });

  it("uses payload.executionVersion over artifact.version when provided", async () => {
    const run = makeRun();
    const executionArtifact = {
      id: "art-exec2",
      runId: run.id,
      type: "ExecutionReport",
      version: 7,
      payloadJson: { executionVersion: 2, score: 0.5 },
      rawText: "",
      createdAt: new Date(),
    };

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "ExecutionReport" ? executionArtifact : null),
    );

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(2);
  });
});
