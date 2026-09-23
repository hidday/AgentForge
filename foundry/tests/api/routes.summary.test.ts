import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Test description",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 202,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

function makeArtifact(type: string, version: number, payloadJson: unknown) {
  return { id: `art-${type}-${version}`, runId: "run-1", type, version, payloadJson, rawText: "", createdAt: new Date() };
}

async function buildApp(artifactsByType: Record<string, unknown> = {}) {
  const mockRunRepo = {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(makeRun()),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) =>
      Promise.resolve(
        Object.prototype.hasOwnProperty.call(artifactsByType, type) ? artifactsByType[type] : null,
      ),
    ),
    create: vi.fn(),
  };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
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
    getLinearClient: vi.fn(),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockRunRepo };
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

  it("returns plan: null, planReview: null, review: null, executionReport: null when no artifacts exist", async () => {
    const { app } = await buildApp({});

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect((body.run as { id: string }).id).toBe("run-1");
  });

  it("normalizes string risks, object risks with a description, and stringifies other risk shapes", async () => {
    const plan = {
      summary: "Do the thing",
      confidence: 0.85,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: false }],
      steps: [{ id: "s1", title: "Step 1", description: "desc" }],
      risks: ["Plain string risk", { description: "Object risk with description" }, { weird: "shape" }],
      testPlan: "run tests",
    };
    const { app } = await buildApp({ Plan: makeArtifact("Plan", 3, plan) });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[]; riskCount: number; version: number } };
    expect(body.plan.version).toBe(3);
    expect(body.plan.riskCount).toBe(3);
    expect(body.plan.risks[0]).toBe("Plain string risk");
    expect(body.plan.risks[1]).toBe("Object risk with description");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ weird: "shape" }));
  });

  it("falls back to String(r) when JSON.stringify throws (circular reference)", async () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const plan = {
      summary: "s",
      confidence: 0.5,
      openQuestions: [],
      steps: [],
      risks: [circular],
      testPlan: "t",
    };
    const { app } = await buildApp({ Plan: makeArtifact("Plan", 1, plan) });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks[0]).toBe(String(circular));
    expect(body.plan.risks[0]).toBe("[object Object]");
  });

  it("defaults openQuestions/steps/risks/riskCount when the plan payload omits them", async () => {
    const plan = { summary: "s", confidence: 0.5, testPlan: "t" };
    const { app } = await buildApp({ Plan: makeArtifact("Plan", 1, plan) });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: { openQuestions: unknown[]; stepCount: number; steps: unknown[]; risks: unknown[]; riskCount: number };
    };
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads verbatim when present", async () => {
    const planReviewPayload = { overallVerdict: "approved", summary: "OK", findings: [] };
    const reviewPayload = { overallVerdict: "changes_requested", summary: "needs work", findings: [] };
    const { app } = await buildApp({
      PlanReview: makeArtifact("PlanReview", 2, planReviewPayload),
      Review: makeArtifact("Review", 1, reviewPayload),
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 2, payload: planReviewPayload });
    expect(body.review).toEqual({ version: 1, payload: reviewPayload });
  });

  it("uses the ExecutionReport payload's executionVersion/score/scoreRationale when present", async () => {
    const execPayload = { executionVersion: 5, score: 0.72, scoreRationale: "solid" };
    const { app } = await buildApp({ ExecutionReport: makeArtifact("ExecutionReport", 5, execPayload) });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score: number; scoreRationale: string };
    };
    expect(body.executionReport).toMatchObject({
      version: 5,
      executionVersion: 5,
      score: 0.72,
      scoreRationale: "solid",
    });
  });

  it("falls back to the artifact's version as executionVersion when the payload omits it", async () => {
    const { app } = await buildApp({ ExecutionReport: makeArtifact("ExecutionReport", 7, {}) });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { executionReport: { version: number; executionVersion: number } };
    expect(body.executionReport.version).toBe(7);
    expect(body.executionReport.executionVersion).toBe(7);
  });
});
