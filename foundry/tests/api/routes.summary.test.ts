import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Do the thing",
    linearIssueTitle: "Add feature",
    linearIssueUrl: "https://linear.app/x/LIN-1",
    repo: "test-repo",
    branchName: "feature/x",
    prNumber: 12,
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

async function buildApp(overrides: {
  run?: unknown | null;
  byType?: Record<string, unknown | null>;
} = {}) {
  const byType = overrides.byType ?? {};
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(overrides.run === undefined ? makeRun() : overrides.run),
    findAll: vi.fn(),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) =>
      Promise.resolve(byType[type] ?? null),
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
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app };
}

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app } = await buildApp({ byType: {} });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run).toMatchObject({ id: "run-1", state: RunState.Done, repo: "test-repo" });
  });

  it("summarizes plan fields, string risks, and object risks with a description", async () => {
    const plan = makeArtifact("Plan", 2, {
      summary: "Implement feature X",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Which auth?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do step 1", extra: "ignored" }],
      risks: ["Plain string risk", { description: "Object risk" }, { other: "no description field" }],
      testPlan: "Run unit tests",
    });
    const { app } = await buildApp({ byType: { Plan: plan } });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      plan: {
        version: number;
        summary: string;
        confidence: number;
        stepCount: number;
        steps: { id: string; title: string; description: string }[];
        risks: string[];
        riskCount: number;
        testPlan: string;
      };
    };
    expect(body.plan.version).toBe(2);
    expect(body.plan.summary).toBe("Implement feature X");
    expect(body.plan.confidence).toBe(0.9);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do step 1" }]);
    expect(body.plan.risks).toEqual(["Plain string risk", "Object risk", '{"other":"no description field"}']);
    expect(body.plan.riskCount).toBe(3);
    expect(body.plan.testPlan).toBe("Run unit tests");
  });

  it("includes planReview and review payloads when present", async () => {
    const planReview = makeArtifact("PlanReview", 1, { verdict: "approved" });
    const review = makeArtifact("Review", 1, { verdict: "pass", notes: "LGTM" });
    const { app } = await buildApp({ byType: { PlanReview: planReview, Review: review } });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "pass", notes: "LGTM" } });
  });

  it("uses the executionReport's own executionVersion/score when present", async () => {
    const executionReport = makeArtifact("ExecutionReport", 3, {
      executionVersion: 7,
      score: 0.85,
      scoreRationale: "Solid implementation",
    });
    const { app } = await buildApp({ byType: { ExecutionReport: executionReport } });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as {
      executionReport: { version: number; executionVersion: number; score: number; scoreRationale: string };
    };
    expect(body.executionReport).toMatchObject({
      version: 3,
      executionVersion: 7,
      score: 0.85,
      scoreRationale: "Solid implementation",
    });
  });

  it("falls back to the artifact version when executionVersion is absent from the payload", async () => {
    const executionReport = makeArtifact("ExecutionReport", 5, { score: 0.5 });
    const { app } = await buildApp({ byType: { ExecutionReport: executionReport } });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(5);
  });
});
