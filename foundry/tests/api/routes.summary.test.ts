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
    linearIssueTitle: "Add feature",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "org/repo",
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
    latestArtifactVersion: 2,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function makeArtifact(type: string, version: number, payloadJson: unknown) {
  return { id: `art-${type}`, runId: "run-1", type, version, payloadJson, rawText: "", createdAt: new Date() };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn(), create: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
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

  it("returns plan: null and other sections null when no artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
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

  it("builds plan summary with string risks, steps and open questions", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const planPayload = {
      summary: "Do the thing",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Which db?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do step 1" }],
      risks: ["Risk A", "Risk B"],
      testPlan: "Run unit tests",
    };

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 2, planPayload));
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
    expect(body.plan.confidence).toBe(0.9);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do step 1" }]);
    expect(body.plan.risks).toEqual(["Risk A", "Risk B"]);
    expect(body.plan.riskCount).toBe(2);
    expect(body.plan.testPlan).toBe("Run unit tests");
  });

  it("extracts risk descriptions from object-shaped risks and stringifies other shapes", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const planPayload = {
      summary: "Do the thing",
      risks: [{ description: "Object risk" }, { severity: "high" }, 42],
    };

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, planPayload));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[]; riskCount: number; stepCount: number; steps: unknown[] } };
    expect(body.plan.risks[0]).toBe("Object risk");
    // Object without a string `description` field falls back to JSON.stringify
    expect(body.plan.risks[1]).toBe(JSON.stringify({ severity: "high" }));
    // A primitive falls back to JSON.stringify as well
    expect(body.plan.risks[2]).toBe(JSON.stringify(42));
    expect(body.plan.riskCount).toBe(3);
    // No `steps` array in the payload => stepCount 0 and steps []
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
  });

  it("falls back to String(r) when a risk object cannot be JSON.stringify'd (e.g. circular reference)", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const planPayload = { summary: "Circular risk", risks: [circular] };

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, planPayload));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["[object Object]"]);
  });

  it("defaults openQuestions to [] and riskTexts to [] when the plan omits them", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const planPayload = { summary: "Minimal plan" };

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, planPayload));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { openQuestions: unknown[]; risks: unknown[]; riskCount: number } };
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact("PlanReview", 1, { verdict: "approve" }));
      if (type === "Review") return Promise.resolve(makeArtifact("Review", 1, { verdict: "pass" }));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      planReview: { version: number; payload: { verdict: string } };
      review: { version: number; payload: { verdict: string } };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "pass" } });
  });

  it("derives executionReport fields from payload when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const execPayload = { executionVersion: 5, score: 0.87, scoreRationale: "Solid implementation" };
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact("ExecutionReport", 3, execPayload));
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
    expect(body.executionReport.version).toBe(3);
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBe(0.87);
    expect(body.executionReport.scoreRationale).toBe("Solid implementation");
  });

  it("falls back executionVersion to artifact version when payload omits it", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", 4, null));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score?: number };
    };
    expect(body.executionReport.version).toBe(4);
    expect(body.executionReport.executionVersion).toBe(4);
    expect(body.executionReport.score).toBeUndefined();
  });

  it("includes the full linear issue block and top-level run fields", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    const run = makeRun({ prNumber: 12, branchName: "fix/bug" });
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      run: {
        prNumber: number;
        branchName: string;
        repo: string;
        planVersion: number;
        approvedPlanVersion: number;
        linearIssue: { title: string; url: string; description: string };
      };
    };
    expect(body.run.prNumber).toBe(12);
    expect(body.run.branchName).toBe("fix/bug");
    expect(body.run.repo).toBe("org/repo");
    expect(body.run.planVersion).toBe(2);
    expect(body.run.approvedPlanVersion).toBe(2);
    expect(body.run.linearIssue.title).toBe("Add feature");
    expect(body.run.linearIssue.description).toBe("desc");
  });
});
