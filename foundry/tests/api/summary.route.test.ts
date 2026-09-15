import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Do the thing",
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/issue/ENG-42",
    repo: "test-repo",
    branchName: "feature/login",
    prNumber: 7,
    state: RunState.Implementing,
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
  return { id: `art-${type}-${version}`, runId: "run-1", type, version, payloadJson, rawText: "" };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findLatestByType: vi.fn().mockResolvedValue(null) };
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
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

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
    expect(body.run.linearIssue.identifier).toBe("ENG-42");
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("maps plan risks of mixed shapes: string, {description}, plain object, and a circular object", async () => {
    const run = makeRun();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const plan = {
      summary: "Add login flow",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Which OAuth provider?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Add route", description: "Create /login" }],
      risks: ["plain string risk", { description: "object risk with description" }, { code: 42 }, circular],
      testPlan: "Run e2e tests",
    };

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 2, plan));
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
        steps: unknown[];
        risks: string[];
        riskCount: number;
        testPlan: string;
      };
    };
    expect(body.plan.version).toBe(2);
    expect(body.plan.summary).toBe("Add login flow");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Add route", description: "Create /login" }]);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk with description");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ code: 42 }));
    // Circular object: JSON.stringify throws, falls back to String(r)
    expect(body.plan.risks[3]).toBe("[object Object]");
    expect(body.plan.riskCount).toBe(4);
    expect(body.plan.testPlan).toBe("Run e2e tests");
  });

  it("defaults openQuestions/steps/risks to empty when absent or non-array, and includes planReview/review", async () => {
    const run = makeRun();
    const plan = { summary: "Minimal plan", confidence: 0.5 };
    const planReviewPayload = { verdict: "approve", notes: "looks fine" };
    const reviewPayload = { verdict: "pass", score: 8 };

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", 1, planReviewPayload));
      if (type === "Review") return Promise.resolve(makeArtifact("Review", 1, reviewPayload));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: { openQuestions: unknown[]; steps: unknown[]; risks: unknown[]; stepCount: number; riskCount: number };
      planReview: { version: number; payload: unknown } | null;
      review: { version: number; payload: unknown } | null;
    };
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
    expect(body.planReview).toEqual({ version: 1, payload: planReviewPayload });
    expect(body.review).toEqual({ version: 1, payload: reviewPayload });
  });

  it("includes executionReport with payload-provided executionVersion/score/scoreRationale", async () => {
    const run = makeRun();
    const executionPayload = { executionVersion: 3, score: 0.85, scoreRationale: "Solid coverage" };

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", 5, executionPayload));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executionReport: {
        version: number;
        executionVersion: number;
        score: number;
        scoreRationale: string;
        payload: unknown;
      } | null;
    };
    expect(body.executionReport).toEqual({
      version: 5,
      executionVersion: 3,
      score: 0.85,
      scoreRationale: "Solid coverage",
      payload: executionPayload,
    });
  });

  it("falls back to artifact.version for executionVersion when payload is null", async () => {
    const run = makeRun();

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", 9, null));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score?: number } | null;
    };
    expect(body.executionReport).not.toBeNull();
    expect(body.executionReport!.version).toBe(9);
    expect(body.executionReport!.executionVersion).toBe(9);
    expect(body.executionReport!.score).toBeUndefined();
  });
});
