import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-7",
    linearIssueDescription: "Some description",
    linearIssueTitle: "Add feature",
    linearIssueUrl: "https://linear.app/team/issue/ENG-7",
    repo: "test-repo",
    branchName: "feature-branch",
    prNumber: 42,
    state: RunState.AIReview,
    planVersion: 2,
    approvedPlanVersion: 1,
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
  return { id: `art-${type}`, runId: "run-1", type, version, payloadJson, createdAt: new Date() };
}

async function buildApp(options: {
  run?: ReturnType<typeof makeRun> | null;
  findLatestByTypeImpl?: (runId: string, type: string) => unknown;
} = {}) {
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(options.run === undefined ? makeRun() : options.run),
  };
  const mockArtifactRepo = {
    findLatestByType: vi.fn().mockImplementation(
      options.findLatestByTypeImpl ?? (() => null),
    ),
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
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

  await app.ready();
  return { app, mockArtifactRepo };
}

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns plan: null and planReview/review/executionReport: null when no artifacts exist", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    const run = body.run as Record<string, unknown>;
    expect(run.id).toBe("run-1");
    expect(run.linearIssue).toEqual({
      id: "LIN-1",
      identifier: "ENG-7",
      title: "Add feature",
      url: "https://linear.app/team/issue/ENG-7",
      description: "Some description",
    });
  });

  it("normalizes risks of mixed shapes: plain strings, objects with description, and others via JSON.stringify", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const planPayload = {
      summary: "Plan summary",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Use OAuth?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
      risks: ["plain string risk", { description: "object risk" }, { noDescription: true }, circular],
      testPlan: "Run the test suite",
    };

    const { app, mockArtifactRepo } = await buildApp({
      findLatestByTypeImpl: (_runId, type) =>
        type === "Plan" ? makeArtifact("Plan", 2, planPayload) : null,
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: Record<string, unknown> };
    expect(body.plan.version).toBe(2);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do the thing" }]);
    const risks = body.plan.risks as string[];
    expect(risks[0]).toBe("plain string risk");
    expect(risks[1]).toBe("object risk");
    expect(risks[2]).toBe(JSON.stringify({ noDescription: true }));
    // Circular reference: JSON.stringify throws, falls back to String(r)
    expect(risks[3]).toBe("[object Object]");
    expect(body.plan.riskCount).toBe(4);
    expect(mockArtifactRepo.findLatestByType).toHaveBeenCalledWith("run-1", "Plan");
    expect(mockArtifactRepo.findLatestByType).toHaveBeenCalledWith("run-1", "PlanReview");
    expect(mockArtifactRepo.findLatestByType).toHaveBeenCalledWith("run-1", "Review");
    expect(mockArtifactRepo.findLatestByType).toHaveBeenCalledWith("run-1", "ExecutionReport");
  });

  it("defaults openQuestions/steps/risks when the plan payload omits them", async () => {
    const { app } = await buildApp({
      findLatestByTypeImpl: (_runId, type) =>
        type === "Plan" ? makeArtifact("Plan", 1, { summary: "minimal plan" }) : null,
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: Record<string, unknown> };
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads verbatim when present", async () => {
    const planReviewPayload = { verdict: "approve", notes: "looks fine" };
    const reviewPayload = { verdict: "changes_requested", notes: "fix the tests" };

    const { app } = await buildApp({
      findLatestByTypeImpl: (_runId, type) => {
        if (type === "PlanReview") return makeArtifact("PlanReview", 3, planReviewPayload);
        if (type === "Review") return makeArtifact("Review", 5, reviewPayload);
        return null;
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 3, payload: planReviewPayload });
    expect(body.review).toEqual({ version: 5, payload: reviewPayload });
  });

  it("uses the executionReport payload's executionVersion when present", async () => {
    const executionPayload = { executionVersion: 7, score: 0.85, scoreRationale: "solid" };
    const { app } = await buildApp({
      findLatestByTypeImpl: (_runId, type) =>
        type === "ExecutionReport" ? makeArtifact("ExecutionReport", 1, executionPayload) : null,
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { executionReport: Record<string, unknown> };
    expect(body.executionReport.version).toBe(1);
    expect(body.executionReport.executionVersion).toBe(7);
    expect(body.executionReport.score).toBe(0.85);
    expect(body.executionReport.scoreRationale).toBe("solid");
    expect(body.executionReport.payload).toEqual(executionPayload);
  });

  it("falls back to the artifact version when executionVersion is absent from the payload", async () => {
    const executionPayload = { score: 0.5 };
    const { app } = await buildApp({
      findLatestByTypeImpl: (_runId, type) =>
        type === "ExecutionReport" ? makeArtifact("ExecutionReport", 9, executionPayload) : null,
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { executionReport: Record<string, unknown> };
    expect(body.executionReport.version).toBe(9);
    expect(body.executionReport.executionVersion).toBe(9);
    expect(body.executionReport.scoreRationale).toBeUndefined();
  });
});
