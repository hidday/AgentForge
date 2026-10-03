import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-7",
    linearIssueDescription: "Do the thing",
    linearIssueTitle: "The thing",
    linearIssueUrl: "https://linear.app/x/issue/ENG-7",
    repo: "test-repo",
    branchName: "feature/x",
    prNumber: 42,
    state: RunState.Done,
    planVersion: 2,
    approvedPlanVersion: 2,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 4,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

function makeArtifact(type: string, payloadJson: unknown, version = 1) {
  return { id: `art-${type}`, runId: "run-1", type, version, payloadJson, rawText: "", createdAt: new Date() };
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

  it("returns null plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run).toMatchObject({
      id: "run-1",
      state: RunState.Done,
      repo: "test-repo",
      branchName: "feature/x",
      prNumber: 42,
      linearIssue: { identifier: "ENG-7", title: "The thing" },
    });
  });

  it("maps plan risks that are strings, objects with description, and other values", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    // An object whose `description` is present but not a string must fall
    // back to JSON.stringify rather than crashing or returning "undefined".
    const riskWithNonStringDescription: Record<string, unknown> = { description: undefined };
    const plan = {
      summary: "Summary text",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Why?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do it", extra: "ignored" }],
      risks: ["plain string risk", { description: "object risk" }, 42, riskWithNonStringDescription],
      testPlan: "Run the suite",
    };
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan, 3));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.version).toBe(3);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do it" }]);
    expect(body.plan.riskCount).toBe(4);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toBe("42");
    // An object without a usable `description` string falls back to JSON.stringify.
    expect(body.plan.risks[3]).toBe(JSON.stringify(riskWithNonStringDescription));
  });

  it("includes planReview and review payloads when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", { verdict: "approve" }, 2));
      if (type === "Review") return Promise.resolve(makeArtifact("Review", { verdict: "pass" }, 1));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.planReview).toEqual({ version: 2, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "pass" } });
  });

  it("uses executionReport.payloadJson.executionVersion/score when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact("ExecutionReport", { executionVersion: 7, score: 0.8, scoreRationale: "solid" }, 5),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executionReport).toEqual({
      version: 5,
      executionVersion: 7,
      score: 0.8,
      scoreRationale: "solid",
      payload: { executionVersion: 7, score: 0.8, scoreRationale: "solid" },
    });
  });

  it("falls back to the artifact version when executionVersion is absent", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", null, 9));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executionReport.executionVersion).toBe(9);
    expect(body.executionReport.score).toBeUndefined();
  });
});
