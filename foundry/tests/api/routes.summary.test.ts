import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Issue description",
    linearIssueTitle: "Issue title",
    linearIssueUrl: "https://linear.app/issue/LIN-1",
    repo: "test-repo",
    branchName: "feature/x",
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

function makeArtifact(type: string, payloadJson: unknown, version = 1) {
  return { id: `art-${type}`, runId: "run-1", type, version, payloadJson, createdAt: new Date() };
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

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run).toMatchObject({
      id: "run-1",
      state: RunState.Done,
      repo: "test-repo",
      branchName: "feature/x",
      prNumber: 7,
    });
    expect((body.run as { linearIssue: { identifier: string } }).linearIssue.identifier).toBe(
      "ENG-1",
    );
  });

  it("maps plan fields, string risks, and object risks with description", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const plan = {
      summary: "Do the thing",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do step 1" }],
      risks: ["plain string risk", { description: "object risk" }, { other: "no description" }],
      testPlan: "run vitest",
    };
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan, 3));
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { plan: Record<string, unknown> };
    expect(body.plan.version).toBe(3);
    expect(body.plan.summary).toBe("Do the thing");
    expect(body.plan.confidence).toBe(0.9);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do step 1" }]);
    expect(body.plan.riskCount).toBe(3);
    expect(body.plan.risks).toEqual([
      "plain string risk",
      "object risk",
      JSON.stringify({ other: "no description" }),
    ]);
    expect(body.plan.testPlan).toBe("run vitest");
  });

  it("defaults openQuestions/steps/risks when absent from the plan payload", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", { summary: "s" }, 1));
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { plan: Record<string, unknown> };
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("stringifies risk objects whose JSON.stringify throws via String(r) fallback", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const circular: Record<string, unknown> = { note: "circular" };
    circular.self = circular;
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", { risks: [circular] }, 1));
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toHaveLength(1);
    expect(body.plan.risks[0]).toBe(String(circular));
  });

  it("includes planReview and review payloads when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") {
        return Promise.resolve(makeArtifact("PlanReview", { verdict: "approve" }, 2));
      }
      if (type === "Review") {
        return Promise.resolve(makeArtifact("Review", { verdict: "pass" }, 5));
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 2, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 5, payload: { verdict: "pass" } });
  });

  it("includes executionReport with executionVersion/score falling back to artifact version", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(makeArtifact("ExecutionReport", {}, 9));
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      executionReport: { version: number; executionVersion: number; score?: number };
    };
    expect(body.executionReport.version).toBe(9);
    expect(body.executionReport.executionVersion).toBe(9);
    expect(body.executionReport.score).toBeUndefined();
  });

  it("includes executionReport with its own executionVersion/score/scoreRationale when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact(
            "ExecutionReport",
            { executionVersion: 42, score: 0.85, scoreRationale: "solid" },
            9,
          ),
        );
      }
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
    expect(body.executionReport.version).toBe(9);
    expect(body.executionReport.executionVersion).toBe(42);
    expect(body.executionReport.score).toBe(0.85);
    expect(body.executionReport.scoreRationale).toBe("solid");
  });
});
