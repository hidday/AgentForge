import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/x",
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
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo };
}

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect((body.run as { id: string }).id).toBe("run-1");
    expect((body.run as { linearIssue: { identifier: string } }).linearIssue.identifier).toBe(
      "ENG-42",
    );
  });

  it("returns full plan/review/executionReport data with string and object risks", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 3,
          payloadJson: {
            summary: "Do the thing",
            confidence: 0.9,
            openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
            risks: ["plain string risk", { description: "object risk" }, 42],
            testPlan: "run tests",
          },
        });
      }
      if (type === "PlanReview") {
        return Promise.resolve({ version: 1, payloadJson: { verdict: "approve" } });
      }
      if (type === "Review") {
        return Promise.resolve({ version: 2, payloadJson: { verdict: "pass" } });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          version: 5,
          payloadJson: { executionVersion: 5, score: 0.8, scoreRationale: "solid" },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: {
        summary: string;
        stepCount: number;
        risks: string[];
        riskCount: number;
        steps: unknown[];
      };
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
      executionReport: { version: number; executionVersion: number; score: number };
    };

    expect(body.plan.summary).toBe("Do the thing");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do it" }]);
    expect(body.plan.risks).toEqual(["plain string risk", "object risk", "42"]);
    expect(body.plan.riskCount).toBe(3);
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 2, payload: { verdict: "pass" } });
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBe(0.8);
  });

  it("falls back to artifact version for executionVersion when payload omits it", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({ version: 9, payloadJson: {} });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { executionReport: { executionVersion: number; version: number } };
    expect(body.executionReport.executionVersion).toBe(9);
    expect(body.executionReport.version).toBe(9);
  });

  it("falls back to String() for a risk object that fails JSON.stringify", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: Record<string, unknown> = { note: "circular" };
    circular.self = circular;

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 1,
          payloadJson: { summary: "has a bad risk", risks: [circular] },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["[object Object]"]);
  });

  it("returns empty risks/steps arrays when plan payload omits them", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({ version: 1, payloadJson: { summary: "no risks or steps" } });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: unknown[]; steps: unknown[]; stepCount: number } };
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
  });
});
