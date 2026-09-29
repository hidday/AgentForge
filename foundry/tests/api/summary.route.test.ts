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
    linearIssueTitle: "The thing",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
    repo: "test-repo",
    branchName: "feature/thing",
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

interface ArtifactStub {
  id: string;
  runId: string;
  type: string;
  version: number;
  payloadJson: unknown;
  rawText: string;
  createdAt: Date;
}

function makeArtifact(type: string, version: number, payloadJson: unknown): ArtifactStub {
  return { id: `art-${type}`, runId: "run-1", type, version, payloadJson, rawText: "", createdAt: new Date() };
}

async function buildApp(latestByType: Record<string, ArtifactStub | null> = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) =>
      Promise.resolve(latestByType[type] ?? null),
    ),
  };
  const mockEventRepo = { findByRunId: vi.fn() };

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
    const { app, mockRunRepo } = await buildApp({});
    mockRunRepo.findById.mockResolvedValue(makeRun());

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

  it("normalizes string, object-with-description, and plain-object risks; maps steps", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const plan = makeArtifact("Plan", 3, {
      summary: "Add feature X",
      confidence: 0.42,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step one", description: "Do step one", extra: "ignored" }],
      risks: ["plain string risk", { description: "object risk" }, { note: "no description" }, circular],
      testPlan: "Run unit tests",
    });

    const { app, mockRunRepo } = await buildApp({ Plan: plan });
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
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
    expect(body.plan.version).toBe(3);
    expect(body.plan.summary).toBe("Add feature X");
    expect(body.plan.confidence).toBe(0.42);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step one", description: "Do step one" }]);
    expect(body.plan.testPlan).toBe("Run unit tests");
    expect(body.plan.riskCount).toBe(4);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ note: "no description" }));
    // Circular object: JSON.stringify throws, falls back to String(r) ("[object Object]").
    expect(body.plan.risks[3]).toBe(String(circular));
  });

  it("defaults steps/risks to empty arrays when plan payload omits them", async () => {
    const plan = makeArtifact("Plan", 1, { summary: "No steps here" });
    const { app, mockRunRepo } = await buildApp({ Plan: plan });
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { stepCount: number; steps: unknown[]; risks: unknown[] } };
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
  });

  it("includes planReview and review payloads when present", async () => {
    const planReview = makeArtifact("PlanReview", 1, { verdict: "approve" });
    const review = makeArtifact("Review", 2, { verdict: "changes_requested" });
    const { app, mockRunRepo } = await buildApp({ PlanReview: planReview, Review: review });
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 2, payload: { verdict: "changes_requested" } });
  });

  it("derives executionReport fields from the payload when present", async () => {
    const executionReport = makeArtifact("ExecutionReport", 5, {
      executionVersion: 9,
      score: 0.87,
      scoreRationale: "Solid coverage",
    });
    const { app, mockRunRepo } = await buildApp({ ExecutionReport: executionReport });
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      executionReport: {
        version: number;
        executionVersion: number;
        score: number;
        scoreRationale: string;
      };
    };
    expect(body.executionReport.version).toBe(5);
    expect(body.executionReport.executionVersion).toBe(9);
    expect(body.executionReport.score).toBe(0.87);
    expect(body.executionReport.scoreRationale).toBe("Solid coverage");
  });

  it("falls back to the artifact version when executionVersion is absent from payload", async () => {
    const executionReport = makeArtifact("ExecutionReport", 4, null);
    const { app, mockRunRepo } = await buildApp({ ExecutionReport: executionReport });
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score: unknown };
    };
    expect(body.executionReport.version).toBe(4);
    expect(body.executionReport.executionVersion).toBe(4);
    expect(body.executionReport.score).toBeUndefined();
  });
});
