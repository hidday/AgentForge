import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Some description",
    linearIssueTitle: "Add auth middleware",
    linearIssueUrl: "https://linear.app/x/issue/ENG-42",
    repo: "test-repo",
    branchName: "feature/auth",
    prNumber: 7,
    state: RunState.Done,
    planVersion: 2,
    approvedPlanVersion: 2,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 4,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function makeArtifact(type: string, version: number, payloadJson: unknown) {
  return { id: `art-${type}`, runId: "run-1", type, version, payloadJson, rawText: "", createdAt: new Date() };
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
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo };
}

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns all-null artifact sections when no artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run).toMatchObject({
      id: "run-1",
      state: RunState.Done,
      repo: "test-repo",
      branchName: "feature/auth",
      prNumber: 7,
      linearIssue: {
        id: "LIN-1",
        identifier: "ENG-42",
        title: "Add auth middleware",
        url: "https://linear.app/x/issue/ENG-42",
        description: "Some description",
      },
    });
  });

  it("returns full plan/planReview/review/executionReport sections when all artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const planPayload = {
      summary: "Add middleware",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Which library?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do thing" }],
      risks: ["simple string risk", { description: "object risk" }, { other: "field" }],
      testPlan: "run unit tests",
    };
    const planArtifact = makeArtifact("Plan", 2, planPayload);
    const planReviewArtifact = makeArtifact("PlanReview", 1, { verdict: "approved" });
    const reviewArtifact = makeArtifact("Review", 1, { verdict: "approved" });
    const executionArtifact = makeArtifact("ExecutionReport", 1, {
      executionVersion: 3,
      score: 0.8,
      scoreRationale: "solid work",
    });

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      if (type === "PlanReview") return Promise.resolve(planReviewArtifact);
      if (type === "Review") return Promise.resolve(reviewArtifact);
      if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, any>;

    expect(body.plan).toMatchObject({
      version: 2,
      summary: "Add middleware",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Which library?", requiredForExecution: true }],
      stepCount: 1,
      steps: [{ id: "s1", title: "Step 1", description: "Do thing" }],
      testPlan: "run unit tests",
    });
    // risks normalization: string passthrough, object.description extraction, JSON.stringify fallback
    expect(body.plan.risks).toEqual([
      "simple string risk",
      "object risk",
      JSON.stringify({ other: "field" }),
    ]);
    expect(body.plan.riskCount).toBe(3);

    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.executionReport).toEqual({
      version: 1,
      executionVersion: 3,
      score: 0.8,
      scoreRationale: "solid work",
      payload: { executionVersion: 3, score: 0.8, scoreRationale: "solid work" },
    });
  });

  it("falls back to artifact version for executionVersion when payload lacks it", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const executionArtifact = makeArtifact("ExecutionReport", 5, {});
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, any>;
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBeUndefined();
  });

  it("falls back to String(r) when a risk object cannot be JSON.stringified (circular reference)", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: Record<string, unknown> = { note: "circular risk" };
    circular.self = circular;
    const planArtifact = makeArtifact("Plan", 1, { summary: "x", risks: [circular] });
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, any>;
    expect(body.plan.risks).toEqual(["[object Object]"]);
    expect(body.plan.riskCount).toBe(1);
  });

  it("returns empty steps/risks arrays when plan payload lacks them", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const planArtifact = makeArtifact("Plan", 1, { summary: "no steps" });
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, any>;
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
    expect(body.plan.openQuestions).toEqual([]);
  });
});
