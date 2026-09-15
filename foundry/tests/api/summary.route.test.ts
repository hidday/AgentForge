import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Do the thing",
    linearIssueTitle: "Add feature",
    linearIssueUrl: "https://linear.app/team/issue/ENG-42",
    repo: "test-repo",
    branchName: "feature/x",
    prNumber: 7,
    state: RunState.Implementing,
    planVersion: 2,
    approvedPlanVersion: 2,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 3,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    ...overrides,
  };
}

function makeArtifact(type: string, version: number, payloadJson: unknown) {
  return {
    id: `art-${type}-${version}`,
    runId: "run-1",
    type,
    version,
    payloadJson,
    rawText: "",
    createdAt: new Date(),
  };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn(), create: vi.fn() };

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
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns plan: null when there is no Plan artifact, and planReview/review/executionReport: null", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run).toMatchObject({ id: "run-1", state: RunState.Implementing });
  });

  it("includes plan details with plain-string risks, planReview, review, and executionReport when all present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const plan = makeArtifact("Plan", 2, {
      summary: "Plan summary",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do step 1" }],
      risks: ["Risk as plain string"],
      testPlan: "Run the tests",
    });
    const planReview = makeArtifact("PlanReview", 1, { summary: "Looks fine" });
    const review = makeArtifact("Review", 1, { summary: "Code review ok" });
    const executionReport = makeArtifact("ExecutionReport", 1, {
      executionVersion: 1,
      score: 0.75,
      scoreRationale: "Solid work",
    });

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(plan);
      if (type === "PlanReview") return Promise.resolve(planReview);
      if (type === "Review") return Promise.resolve(review);
      if (type === "ExecutionReport") return Promise.resolve(executionReport);
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, any>;
    expect(body.plan).toMatchObject({
      version: 2,
      summary: "Plan summary",
      confidence: 0.9,
      stepCount: 1,
      risks: ["Risk as plain string"],
      riskCount: 1,
      testPlan: "Run the tests",
    });
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do step 1" }]);
    expect(body.planReview).toEqual({ version: 1, payload: { summary: "Looks fine" } });
    expect(body.review).toEqual({ version: 1, payload: { summary: "Code review ok" } });
    expect(body.executionReport).toMatchObject({
      version: 1,
      executionVersion: 1,
      score: 0.75,
      scoreRationale: "Solid work",
    });
  });

  it("extracts .description from risk objects that have one", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const plan = makeArtifact("Plan", 1, {
      risks: [{ description: "Object risk description", severity: "high" }],
    });
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? plan : null),
    );

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as Record<string, any>;
    expect(body.plan.risks).toEqual(["Object risk description"]);
  });

  it("falls back to JSON.stringify for risk objects without a string description", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const plan = makeArtifact("Plan", 1, {
      risks: [{ severity: "high", note: "no description field" }],
    });
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? plan : null),
    );

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as Record<string, any>;
    expect(body.plan.risks).toEqual([JSON.stringify({ severity: "high", note: "no description field" })]);
  });

  it("falls back to String(r) when a risk object throws on JSON.stringify (circular reference)", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const circular: Record<string, unknown> = { severity: "high" };
    circular.self = circular;
    const plan = makeArtifact("Plan", 1, { risks: [circular] });
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? plan : null),
    );

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as Record<string, any>;
    expect(body.plan.risks).toEqual([String(circular)]);
  });

  it("defaults stepCount/steps/openQuestions/risks when Plan artifact has none of those fields", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const plan = makeArtifact("Plan", 1, { summary: "Bare plan" });
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "Plan" ? plan : null),
    );

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as Record<string, any>;
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("falls back to artifact.version for executionVersion when payload omits it", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const executionReport = makeArtifact("ExecutionReport", 4, { score: 0.5 });
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      Promise.resolve(type === "ExecutionReport" ? executionReport : null),
    );

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as Record<string, any>;
    expect(body.executionReport.executionVersion).toBe(4);
    expect(body.executionReport.version).toBe(4);
  });
});
