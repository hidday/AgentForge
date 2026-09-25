import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Some description",
    linearIssueTitle: "Add feature",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "test-repo",
    branchName: "feature/add-x",
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
  return { id: `art-${type}-${version}`, runId: "run-1", type, version, payloadJson, rawText: "" };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
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

  it("returns 404 when the run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns null plan/planReview/review/executionReport when no artifacts exist", async () => {
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
      branchName: "feature/add-x",
      prNumber: 7,
      linearIssue: {
        id: "LIN-1",
        identifier: "ENG-1",
        title: "Add feature",
        url: "https://linear.app/team/issue/ENG-1",
        description: "Some description",
      },
    });
  });

  it("summarizes a plan with string risks, steps and open questions", async () => {
    const run = makeRun();
    const plan = {
      summary: "Add the feature",
      confidence: 0.85,
      openQuestions: [{ id: "q1", question: "Which auth?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
      risks: ["Might break auth"],
      testPlan: "Run unit tests",
    };
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 2, plan));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: Record<string, unknown> };
    expect(body.plan).toMatchObject({
      version: 2,
      summary: "Add the feature",
      confidence: 0.85,
      stepCount: 1,
      riskCount: 1,
      risks: ["Might break auth"],
      testPlan: "Run unit tests",
    });
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do the thing" }]);
    expect(body.plan.openQuestions).toEqual([
      { id: "q1", question: "Which auth?", requiredForExecution: true },
    ]);
  });

  it("summarizes a plan whose risks are objects with a description field", async () => {
    const run = makeRun();
    const plan = {
      summary: "Add feature",
      risks: [{ description: "Data loss risk" }, { other: "no description" }],
    };
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks[0]).toBe("Data loss risk");
    // object without a string `description` falls back to JSON.stringify
    expect(body.plan.risks[1]).toBe(JSON.stringify({ other: "no description" }));
  });

  it("handles a plan with no steps/risks arrays (defaults to empty)", async () => {
    const run = makeRun();
    const plan = { summary: "Minimal plan" };
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: { steps: unknown[]; stepCount: number; risks: unknown[]; riskCount: number };
    };
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact("PlanReview", 1, { verdict: "approve" }));
      if (type === "Review") return Promise.resolve(makeArtifact("Review", 1, { verdict: "pass" }));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "pass" } });
  });

  it("includes executionReport with explicit executionVersion/score/scoreRationale", async () => {
    const run = makeRun();
    const executionPayload = {
      executionVersion: 3,
      score: 0.92,
      scoreRationale: "All tests pass",
    };
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact("ExecutionReport", 5, executionPayload));
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
      };
    };
    expect(body.executionReport).toEqual({
      version: 5,
      executionVersion: 3,
      score: 0.92,
      scoreRationale: "All tests pass",
      payload: executionPayload,
    });
  });

  it("falls back executionVersion to artifact version when payload omits it", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", 9, {}));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(9);
  });
});
