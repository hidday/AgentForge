import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "Some description",
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
    repo: "test-repo",
    branchName: "feature/login",
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
  return { id: `art-${type}-${version}`, runId: "run-1", type, version, payloadJson, rawText: "" };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn() };
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
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  await app.ready();
  return { app, mockRunRepo, mockArtifactRepo };
}

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 with an error body when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns null plan/planReview/review/executionReport when no artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      run: { id: string; linearIssue: { id: string } };
      plan: unknown;
      planReview: unknown;
      review: unknown;
      executionReport: unknown;
    };
    expect(body.run.id).toBe("run-1");
    expect(body.run.linearIssue.id).toBe("LIN-1");
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("maps plan fields, string risks, object risks and unknown risks into riskTexts", async () => {
    const run = makeRun();
    const circular: Record<string, unknown> = { description: undefined };
    circular.self = circular; // forces JSON.stringify to throw -> exercises String(r) fallback

    const plan = makeArtifact("Plan", 2, {
      summary: "Add a login form",
      confidence: 0.8,
      openQuestions: [{ id: "q1", question: "OAuth or password?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Build form", description: "Create the React form" }],
      risks: ["plain string risk", { description: "object risk" }, circular],
      testPlan: "Run e2e tests",
    });

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(plan);
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
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
    expect(body.plan.summary).toBe("Add a login form");
    expect(body.plan.confidence).toBe(0.8);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([
      { id: "s1", title: "Build form", description: "Create the React form" },
    ]);
    expect(body.plan.riskCount).toBe(3);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    // circular object: JSON.stringify throws, falls back to String(r) => "[object Object]"
    expect(body.plan.risks[2]).toBe("[object Object]");
    expect(body.plan.testPlan).toBe("Run e2e tests");
  });

  it("defaults stepCount/steps/risks to empty when plan has no steps/risks arrays", async () => {
    const run = makeRun();
    const plan = makeArtifact("Plan", 1, { summary: "No steps yet" });

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(plan);
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      plan: { stepCount: number; steps: unknown[]; risks: unknown[]; riskCount: number };
    };
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads when present", async () => {
    const run = makeRun();
    const planReview = makeArtifact("PlanReview", 1, { verdict: "approved" });
    const review = makeArtifact("Review", 1, { verdict: "changes_requested" });

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve(planReview);
      if (type === "Review") return Promise.resolve(review);
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      planReview: { version: number; payload: { verdict: string } };
      review: { version: number; payload: { verdict: string } };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "changes_requested" } });
  });

  it("falls back to the artifact version when executionReport payload omits executionVersion", async () => {
    const run = makeRun();
    const executionReport = makeArtifact("ExecutionReport", 3, {
      score: 0.9,
      scoreRationale: "Covered all cases",
    });

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(executionReport);
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      executionReport: {
        version: number;
        executionVersion: number;
        score: number;
        scoreRationale: string;
      };
    };
    expect(body.executionReport.version).toBe(3);
    expect(body.executionReport.executionVersion).toBe(3);
    expect(body.executionReport.score).toBe(0.9);
    expect(body.executionReport.scoreRationale).toBe("Covered all cases");
  });

  it("uses the payload's own executionVersion when provided", async () => {
    const run = makeRun();
    const executionReport = makeArtifact("ExecutionReport", 3, {
      executionVersion: 7,
      score: 0.5,
    });

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(executionReport);
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(7);
  });
});
