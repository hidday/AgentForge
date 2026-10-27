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
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/x",
    repo: "test-repo",
    branchName: "feature/x",
    prNumber: 42,
    state: RunState.AIReview,
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

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns run info with null plan/planReview/review/executionReport when no artifacts exist", async () => {
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

  it("builds plan summary with string risks and openQuestions/steps fallbacks", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "plan-1",
          version: 2,
          payloadJson: {
            summary: "Do the thing",
            confidence: 0.9,
            steps: [{ id: "s1", title: "Step 1", description: "desc 1" }],
            risks: ["Risk as plain string"],
            testPlan: "Run unit tests",
            // openQuestions intentionally omitted to exercise the ?? [] fallback
          },
        });
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
        steps: unknown[];
        risks: string[];
        riskCount: number;
        testPlan: string;
      };
    };
    expect(body.plan.version).toBe(2);
    expect(body.plan.summary).toBe("Do the thing");
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "desc 1" }]);
    expect(body.plan.risks).toEqual(["Risk as plain string"]);
    expect(body.plan.riskCount).toBe(1);
    expect(body.plan.testPlan).toBe("Run unit tests");
  });

  it("extracts a risk object's description field", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "plan-1",
          version: 1,
          payloadJson: {
            risks: [{ description: "Risk from object" }],
          },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["Risk from object"]);
  });

  it("JSON-stringifies a risk object with no usable description field", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "plan-1",
          version: 1,
          payloadJson: {
            risks: [{ severity: "high" }],
          },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([JSON.stringify({ severity: "high" })]);
  });

  it("falls back to String(r) when JSON.stringify throws on a circular risk object", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: Record<string, unknown> = { severity: "high" };
    circular.self = circular;

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "plan-1",
          version: 1,
          payloadJson: { risks: [circular] },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([String(circular)]);
  });

  it("treats a non-array risks field as an empty risk list", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({ id: "plan-1", version: 1, payloadJson: { risks: "not-an-array" } });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[]; riskCount: number } };
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") {
        return Promise.resolve({ id: "pr-1", version: 1, payloadJson: { verdict: "approve" } });
      }
      if (type === "Review") {
        return Promise.resolve({ id: "rv-1", version: 1, payloadJson: { verdict: "pass" } });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      planReview: { version: number; payload: { verdict: string } };
      review: { version: number; payload: { verdict: string } };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "pass" } });
  });

  it("derives executionReport fields and falls back to artifact version when executionVersion is absent", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "exec-1",
          version: 5,
          payloadJson: { score: 0.8, scoreRationale: "solid" },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      executionReport: {
        version: number;
        executionVersion: number;
        score: number;
        scoreRationale: string;
        payload: unknown;
      };
    };
    expect(body.executionReport.version).toBe(5);
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBe(0.8);
    expect(body.executionReport.scoreRationale).toBe("solid");
  });

  it("uses the explicit executionVersion from the payload when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "exec-1",
          version: 5,
          payloadJson: { executionVersion: 3, score: 0.5 },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(3);
  });

  it("handles a null executionReport payloadJson gracefully", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({ id: "exec-1", version: 1, payloadJson: null });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score: undefined };
    };
    expect(body.executionReport.version).toBe(1);
    expect(body.executionReport.executionVersion).toBe(1);
    expect(body.executionReport.score).toBeUndefined();
  });
});
