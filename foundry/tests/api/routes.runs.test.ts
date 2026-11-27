import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Desc",
    linearIssueTitle: "Add feature",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "acme/repo",
    branchName: "feature/x",
    prNumber: 42,
    state: RunState.Implementing,
    planVersion: 2,
    approvedPlanVersion: 2,
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

function makeArtifact(type: string, version: number, payloadJson: unknown) {
  return { id: `art-${type}-${version}`, runId: "run-1", type, version, payloadJson, rawText: "", createdAt: new Date() };
}

async function buildApp(orchestratorOverrides: Record<string, unknown> = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    ...orchestratorOverrides,
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

  it("returns { runs } calling findAll with undefined state when no query is given", async () => {
    const { app, mockRunRepo } = await buildApp();
    const runs = [makeRun()];
    mockRunRepo.findAll.mockResolvedValue(runs);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    // Fastify serializes the response through JSON, so Date fields on the
    // mocked run become ISO strings; compare against the same round-trip.
    expect(res.json()).toEqual(JSON.parse(JSON.stringify({ runs })));
  });

  it("passes the state query param through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Todo" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Todo");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns { run, artifacts, events } when the run exists", async () => {
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    const run = makeRun();
    const artifacts = [makeArtifact("Plan", 1, { summary: "x" })];
    const events = [{ id: "e1", eventType: "PLAN_CREATED" }];
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue(artifacts);
    mockEventRepo.findByRunId.mockResolvedValue(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith(run.id);
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith(run.id);
    const body = res.json() as { run: unknown; artifacts: unknown; events: unknown };
    expect(body.artifacts).toEqual(JSON.parse(JSON.stringify(artifacts)));
    expect(body.events).toEqual(JSON.parse(JSON.stringify(events)));
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
  });

  it("returns { artifacts } for an existing run", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const artifacts = [makeArtifact("Review", 1, {})];
    mockArtifactRepo.findByRunId.mockResolvedValue(artifacts);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(JSON.parse(JSON.stringify({ artifacts })));
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
  });

  it("returns { events } for an existing run", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const events = [{ id: "e1", eventType: "PLAN_CREATED" }];
    mockEventRepo.findByRunId.mockResolvedValue(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events });
  });
});

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns plan: null, planReview: null, review: null, executionReport: null when no artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: unknown;
      planReview: unknown;
      review: unknown;
      executionReport: unknown;
      run: { id: string; linearIssue: { identifier: string } };
    };
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
    expect(body.run.linearIssue.identifier).toBe("ENG-1");
  });

  it("includes full plan details, risks-as-strings, and open questions when a Plan artifact exists", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 3, {
            summary: "Implement feature X",
            confidence: 0.9,
            openQuestions: [{ id: "q1", question: "Which API?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Step 1", description: "Do it", extra: "ignored" }],
            risks: ["Risk one as a string"],
            testPlan: "Run unit tests",
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
        openQuestions: unknown[];
        stepCount: number;
        steps: { id: string; title: string; description: string }[];
        risks: string[];
        riskCount: number;
        testPlan: string;
      };
    };
    expect(body.plan.version).toBe(3);
    expect(body.plan.summary).toBe("Implement feature X");
    expect(body.plan.confidence).toBe(0.9);
    expect(body.plan.openQuestions).toHaveLength(1);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps[0]).toEqual({ id: "s1", title: "Step 1", description: "Do it" });
    expect(body.plan.risks).toEqual(["Risk one as a string"]);
    expect(body.plan.riskCount).toBe(1);
    expect(body.plan.testPlan).toBe("Run unit tests");
  });

  it("extracts a risk description from a risk object that has a 'description' field", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 1, { risks: [{ description: "Object-shaped risk", severity: "high" }] }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["Object-shaped risk"]);
  });

  it("falls back to JSON.stringify for a risk object without a usable 'description' field", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(makeArtifact("Plan", 1, { risks: [{ severity: "high", code: 7 }] }));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([JSON.stringify({ severity: "high", code: 7 })]);
  });

  it("falls back to String(r) when JSON.stringify throws on a circular risk object", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const circular: Record<string, unknown> = { severity: "high" };
    circular.self = circular;
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(makeArtifact("Plan", 1, { risks: [circular] }));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["[object Object]"]);
  });

  it("defaults risks/openQuestions/stepCount to empty when the fields are absent or not arrays", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(makeArtifact("Plan", 1, { summary: "No steps/risks here" }));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as {
      plan: { openQuestions: unknown[]; stepCount: number; steps: unknown[]; risks: unknown[]; riskCount: number };
    };
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads when those artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", 2, { approved: true }));
      if (type === "Review") return Promise.resolve(makeArtifact("Review", 1, { passed: false }));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 2, payload: { approved: true } });
    expect(body.review).toEqual({ version: 1, payload: { passed: false } });
  });

  it("includes executionReport with executionVersion/score/scoreRationale derived from the payload", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact("ExecutionReport", 5, {
            executionVersion: 9,
            score: 0.75,
            scoreRationale: "Covers all cases",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score: number; scoreRationale: string };
    };
    expect(body.executionReport.version).toBe(5);
    expect(body.executionReport.executionVersion).toBe(9);
    expect(body.executionReport.score).toBe(0.75);
    expect(body.executionReport.scoreRationale).toBe("Covers all cases");
  });

  it("falls back executionVersion to the artifact version when the payload omits it", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(makeArtifact("ExecutionReport", 4, null));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json() as { executionReport: { executionVersion: number; score: unknown } };
    expect(body.executionReport.executionVersion).toBe(4);
    expect(body.executionReport.score).toBeUndefined();
  });
});
