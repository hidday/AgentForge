import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun() {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-7",
    linearIssueDescription: "Add login support",
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/team/issue/ENG-7",
    repo: "test-repo",
    branchName: "feature/login",
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
  };
}

function makeArtifact(type: string, version: number, payloadJson: unknown) {
  return {
    id: `artifact-${type}-${version}`,
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
  const mockArtifactRepo = {
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
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
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
  );

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

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("returns a run with null plan/review/executionReport when no artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      run: { id: string; linearIssue: { identifier: string } };
      plan: unknown;
      planReview: unknown;
      review: unknown;
      executionReport: unknown;
    };
    expect(body.run.id).toBe("run-1");
    expect(body.run.linearIssue.identifier).toBe("ENG-7");
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("maps plan steps/risks (string risks) and open questions when a Plan artifact exists", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 2, {
            summary: "Add login flow",
            confidence: 0.9,
            openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Add route", description: "Add /login route" }],
            risks: ["Session handling may regress"],
            testPlan: "Run auth e2e tests",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
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
    expect(body.plan.summary).toBe("Add login flow");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Add route", description: "Add /login route" }]);
    expect(body.plan.risks).toEqual(["Session handling may regress"]);
    expect(body.plan.riskCount).toBe(1);
    expect(body.plan.testPlan).toBe("Run auth e2e tests");
  });

  it("extracts risk description from object risks", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 1, {
            risks: [{ description: "Data loss risk" }],
          }),
        );
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["Data loss risk"]);
  });

  it("falls back to JSON.stringify for risk objects without a string description", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 1, {
            risks: [{ severity: "high" }],
          }),
        );
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([JSON.stringify({ severity: "high" })]);
  });

  it("falls back to String() for a risk object that JSON.stringify cannot serialize", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: Record<string, unknown> = { severity: "high" };
    circular.self = circular; // circular reference makes JSON.stringify throw

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(makeArtifact("Plan", 1, { risks: [circular] }));
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([String(circular)]);
  });

  it("includes planReview and review payloads when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") {
        return Promise.resolve(makeArtifact("PlanReview", 1, { verdict: "approve" }));
      }
      if (type === "Review") {
        return Promise.resolve(makeArtifact("Review", 3, { verdict: "needs_changes" }));
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 3, payload: { verdict: "needs_changes" } });
  });

  it("maps executionReport using the payload's own executionVersion/score when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact("ExecutionReport", 5, {
            executionVersion: 2,
            score: 0.8,
            scoreRationale: "Tests pass",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as {
      executionReport: {
        version: number;
        executionVersion: number;
        score: number;
        scoreRationale: string;
      };
    };
    expect(body.executionReport.version).toBe(5);
    expect(body.executionReport.executionVersion).toBe(2);
    expect(body.executionReport.score).toBe(0.8);
    expect(body.executionReport.scoreRationale).toBe("Tests pass");
  });

  it("falls back to artifact version when executionReport payload has no executionVersion", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(makeArtifact("ExecutionReport", 7, null));
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = response.json() as { executionReport: { version: number; executionVersion: number } };
    expect(body.executionReport.version).toBe(7);
    expect(body.executionReport.executionVersion).toBe(7);
  });
});
