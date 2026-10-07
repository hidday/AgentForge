import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
    linearIssueDescription: "Some description",
    repo: "test-repo",
    branchName: "feature/login",
    prNumber: 12,
    state: RunState.AwaitingPlanApproval,
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

async function buildApp(repoOverrides: {
  runRepo?: Record<string, unknown>;
  artifactRepo?: Record<string, unknown>;
  eventRepo?: Record<string, unknown>;
} = {}) {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    ...repoOverrides.runRepo,
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    ...repoOverrides.artifactRepo,
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    ...repoOverrides.eventRepo,
  };

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
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo };
}

describe("GET /api/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { runs } from findAll with no state filter", async () => {
    const runs = [makeRun(), makeRun({ id: "run-2" })];
    const { app, mockRunRepo } = await buildApp({ runRepo: { findAll: vi.fn().mockResolvedValue(runs) } });

    const response = await app.inject({ method: "GET", url: "/api/runs" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(JSON.parse(JSON.stringify({ runs })));
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
  });

  it("passes the state querystring through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();

    await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns run, artifacts and events together when found", async () => {
    const run = makeRun();
    const artifacts = [{ id: "art-1" }];
    const events = [{ id: "evt-1" }];
    const { app } = await buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepo: { findByRunId: vi.fn().mockResolvedValue(artifacts) },
      eventRepo: { findByRunId: vi.fn().mockResolvedValue(events) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(JSON.parse(JSON.stringify({ run, artifacts, events })));
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(response.statusCode).toBe(404);
  });

  it("returns the run's artifacts when found", async () => {
    const run = makeRun();
    const artifacts = [{ id: "art-1", type: "Plan" }];
    const { app, mockArtifactRepo } = await buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepo: { findByRunId: vi.fn().mockResolvedValue(artifacts) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ artifacts });
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(response.statusCode).toBe(404);
  });

  it("returns the run's events when found", async () => {
    const run = makeRun();
    const events = [{ id: "evt-1", eventType: "PLAN_CREATED" }];
    const { app } = await buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      eventRepo: { findByRunId: vi.fn().mockResolvedValue(events) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ events });
  });
});

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(response.statusCode).toBe(404);
  });

  it("returns plan: null and review sections: null when no artifacts exist", async () => {
    const run = makeRun();
    const { app } = await buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepo: { findLatestByType: vi.fn().mockResolvedValue(null) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      plan: unknown;
      planReview: unknown;
      review: unknown;
      executionReport: unknown;
      run: { id: string; linearIssue: { identifier: string | null } };
    };
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
    expect(body.run.linearIssue.identifier).toBe("LIN-1");
  });

  it("builds a full summary with plan (string risks), planReview, review and executionReport", async () => {
    const run = makeRun();
    const planArtifact = {
      id: "art-plan",
      version: 2,
      payloadJson: {
        summary: "Implement login",
        confidence: 0.8,
        openQuestions: [{ id: "q1", question: "Which flow?", requiredForExecution: true }],
        steps: [{ id: "s1", title: "Add route", description: "Add /login route" }],
        risks: ["Risk as plain string", { description: "Risk as object" }, { foo: "bar" }],
        testPlan: "Run e2e tests",
      },
    };
    const planReviewArtifact = { version: 1, payloadJson: { verdict: "approve" } };
    const reviewArtifact = { version: 3, payloadJson: { verdict: "needs-work" } };
    const executionArtifact = {
      version: 4,
      payloadJson: { executionVersion: 2, score: 0.95, scoreRationale: "Looks solid" },
    };

    const findLatestByType = vi
      .fn()
      .mockImplementation((_runId: string, type: string) => {
        switch (type) {
          case "Plan":
            return Promise.resolve(planArtifact);
          case "PlanReview":
            return Promise.resolve(planReviewArtifact);
          case "Review":
            return Promise.resolve(reviewArtifact);
          case "ExecutionReport":
            return Promise.resolve(executionArtifact);
          default:
            return Promise.resolve(null);
        }
      });

    const { app } = await buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepo: { findLatestByType },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      plan: {
        version: number;
        summary: string;
        stepCount: number;
        risks: string[];
        riskCount: number;
      };
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
      executionReport: { version: number; executionVersion: number; score: number };
    };

    expect(body.plan.version).toBe(2);
    expect(body.plan.summary).toBe("Implement login");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.risks).toEqual([
      "Risk as plain string",
      "Risk as object",
      JSON.stringify({ foo: "bar" }),
    ]);
    expect(body.plan.riskCount).toBe(3);
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 3, payload: { verdict: "needs-work" } });
    expect(body.executionReport.version).toBe(4);
    expect(body.executionReport.executionVersion).toBe(2);
    expect(body.executionReport.score).toBe(0.95);
  });

  it("falls back to artifact.version for executionVersion when payload omits it", async () => {
    const run = makeRun();
    const executionArtifact = { version: 7, payloadJson: { score: 0.5 } };
    const findLatestByType = vi.fn().mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "ExecutionReport" ? executionArtifact : null),
    );
    const { app } = await buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepo: { findLatestByType },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(7);
  });

  it("falls back to String(risk) when a risk object can't be JSON.stringify'd (e.g. circular reference)", async () => {
    const run = makeRun();
    const circular: Record<string, unknown> = { note: "circular risk" };
    circular.self = circular;
    const planArtifact = { version: 1, payloadJson: { summary: "Plan", risks: [circular] } };
    const findLatestByType = vi.fn().mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? planArtifact : null),
    );
    const { app } = await buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepo: { findLatestByType },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toHaveLength(1);
    expect(body.plan.risks[0]).toBe(String(circular));
  });

  it("defaults openQuestions/steps/risks to empty arrays when the plan payload omits them", async () => {
    const run = makeRun();
    const planArtifact = { version: 1, payloadJson: { summary: "Minimal plan" } };
    const findLatestByType = vi.fn().mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? planArtifact : null),
    );
    const { app } = await buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepo: { findLatestByType },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as {
      plan: { openQuestions: unknown[]; steps: unknown[]; risks: unknown[]; stepCount: number };
    };
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
  });
});
