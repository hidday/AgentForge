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
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "test-repo",
    branchName: "run-branch",
    prNumber: 7,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 2,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function makeArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "art-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: new Date(),
    ...overrides,
  };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
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

  it("lists all runs when no state query is given", async () => {
    const { app, mockRunRepo } = await buildApp();
    const runs = [makeRun(), makeRun({ id: "run-2" })];
    mockRunRepo.findAll.mockResolvedValue(runs);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { runs: unknown[] };
    expect(body.runs).toHaveLength(2);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
  });

  it("passes a single state filter through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([makeRun({ state: RunState.Done })]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
    const body = res.json() as { runs: { state: string }[] };
    expect(body.runs[0].state).toBe(RunState.Done);
  });

  it("passes a comma-separated multi-state filter through verbatim", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Done,Failed" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done,Failed");
    expect(res.json()).toEqual({ runs: [] });
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns run with artifacts and events when found", async () => {
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    const run = makeRun();
    const artifacts = [makeArtifact()];
    const events = [{ id: "evt-1", runId: "run-1", eventType: "PLAN_CREATED" }];
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue(artifacts);
    mockEventRepo.findByRunId.mockResolvedValue(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toHaveLength(1);
    expect(body.events).toHaveLength(1);
    expect(mockRunRepo.findById).toHaveBeenCalledWith("run-1");
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 when the run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns artifacts for an existing run", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const artifacts = [makeArtifact(), makeArtifact({ id: "art-2", version: 2 })];
    mockArtifactRepo.findByRunId.mockResolvedValue(artifacts);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { artifacts: unknown[] };
    expect(body.artifacts).toHaveLength(2);
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
    expect(mockArtifactRepo.findByRunId).not.toHaveBeenCalled();
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns events for an existing run", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const events = [{ id: "evt-1", eventType: "PLAN_CREATED" }];
    mockEventRepo.findByRunId.mockResolvedValue(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[] };
    expect(body.events).toHaveLength(1);
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
    expect(mockEventRepo.findByRunId).not.toHaveBeenCalled();
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

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    const run = makeRun();
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
    expect(mockArtifactRepo.findLatestByType).toHaveBeenCalledWith(run.id, "Plan");
    expect(mockArtifactRepo.findLatestByType).toHaveBeenCalledWith(run.id, "PlanReview");
    expect(mockArtifactRepo.findLatestByType).toHaveBeenCalledWith(run.id, "Review");
    expect(mockArtifactRepo.findLatestByType).toHaveBeenCalledWith(run.id, "ExecutionReport");
  });

  it("aggregates plan (with string risks), planReview, review, and executionReport payloads", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    const run = makeRun();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact({
            type: "Plan",
            version: 3,
            payloadJson: {
              summary: "Add a login flow",
              confidence: 0.9,
              openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
              steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
              risks: ["Might break SSO", { description: "Rate limits" }, { foo: "bar" }, 42],
              testPlan: "Run e2e suite",
            },
          }),
        );
      }
      if (type === "PlanReview") {
        return Promise.resolve(
          makeArtifact({ type: "PlanReview", version: 2, payloadJson: { verdict: "approved" } }),
        );
      }
      if (type === "Review") {
        return Promise.resolve(
          makeArtifact({ type: "Review", version: 1, payloadJson: { verdict: "changes_requested" } }),
        );
      }
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact({
            type: "ExecutionReport",
            version: 5,
            payloadJson: { executionVersion: 5, score: 0.8, scoreRationale: "Solid tests" },
          }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: {
        version: number;
        summary: string;
        confidence: number;
        stepCount: number;
        risks: string[];
        riskCount: number;
      };
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
      executionReport: { version: number; executionVersion: number; score: number };
    };

    expect(body.plan.version).toBe(3);
    expect(body.plan.summary).toBe("Add a login flow");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.risks).toEqual(["Might break SSO", "Rate limits", JSON.stringify({ foo: "bar" }), "42"]);
    expect(body.plan.riskCount).toBe(4);
    expect(body.planReview).toEqual({ version: 2, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "changes_requested" } });
    expect(body.executionReport.version).toBe(5);
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBe(0.8);
  });

  it("falls back to artifact version for executionVersion when payload omits it", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    const run = makeRun();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", version: 9, payloadJson: {} }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { executionReport: { version: number; executionVersion: number } };
    expect(body.executionReport.version).toBe(9);
    expect(body.executionReport.executionVersion).toBe(9);
  });

  it("falls back to String(r) when a risk entry cannot be JSON.stringify'd (circular reference)", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    const run = makeRun();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    mockArtifactRepo.findLatestByType.mockImplementation((runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact({ type: "Plan", version: 1, payloadJson: { risks: [circular] } }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["[object Object]"]);
  });

  it("defaults openQuestions and stepCount when plan payload omits them", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    const run = makeRun();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact({ type: "Plan", version: 1, payloadJson: { summary: "Minimal plan" } }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: { openQuestions: unknown[]; stepCount: number; steps: unknown[]; risks: unknown[] };
    };
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
  });
});
