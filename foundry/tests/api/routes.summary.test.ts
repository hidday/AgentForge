import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-7",
    linearIssueDescription: "Issue description",
    linearIssueTitle: "Add feature",
    linearIssueUrl: "https://linear.app/issue/ENG-7",
    repo: "test-repo",
    branchName: "feature/x",
    prNumber: 42,
    state: RunState.Implementing,
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
  return { id: `art-${type}`, runId: "run-1", type, version, payloadJson, createdAt: new Date() };
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

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns nulls for plan/planReview/review/executionReport when none exist", async () => {
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
      state: RunState.Implementing,
      repo: "test-repo",
      branchName: "feature/x",
      prNumber: 42,
      linearIssue: {
        id: "LIN-1",
        identifier: "ENG-7",
        title: "Add feature",
        url: "https://linear.app/issue/ENG-7",
        description: "Issue description",
      },
    });
  });

  it("maps risks of mixed shapes (string, object with description, other) and derives stepCount", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const planPayload = {
      summary: "Do the thing",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Which approach?", requiredForExecution: true }],
      steps: [
        { id: "s1", title: "Step 1", description: "Do step 1" },
        { id: "s2", title: "Step 2", description: "Do step 2" },
      ],
      risks: ["plain string risk", { description: "object risk" }, { foo: "bar" }, 42],
      testPlan: "Run the tests",
    };

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 3, planPayload));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: {
        version: number;
        stepCount: number;
        risks: string[];
        riskCount: number;
        openQuestions: unknown[];
        testPlan: string;
      };
    };
    expect(body.plan.version).toBe(3);
    expect(body.plan.stepCount).toBe(2);
    expect(body.plan.riskCount).toBe(4);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ foo: "bar" }));
    expect(body.plan.risks[3]).toBe(JSON.stringify(42));
    expect(body.plan.openQuestions).toHaveLength(1);
    expect(body.plan.testPlan).toBe("Run the tests");
  });

  it("handles plan with no risks array and no steps array", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(makeArtifact("Plan", 1, { summary: "no steps or risks" }));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: { stepCount: number; steps: unknown[]; risks: unknown[]; riskCount: number };
    };
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview, review and executionReport payloads when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") {
        return Promise.resolve(makeArtifact("PlanReview", 2, { approved: true }));
      }
      if (type === "Review") {
        return Promise.resolve(makeArtifact("Review", 1, { approved: false, notes: "fix x" }));
      }
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact("ExecutionReport", 5, {
            executionVersion: 5,
            score: 0.8,
            scoreRationale: "solid",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
      executionReport: {
        version: number;
        executionVersion: number;
        score: number;
        scoreRationale: string;
      };
    };
    expect(body.planReview).toEqual({ version: 2, payload: { approved: true } });
    expect(body.review).toEqual({ version: 1, payload: { approved: false, notes: "fix x" } });
    expect(body.executionReport.version).toBe(5);
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBe(0.8);
    expect(body.executionReport.scoreRationale).toBe("solid");
  });

  it("falls back to artifact version for executionVersion when payload lacks it", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(makeArtifact("ExecutionReport", 7, null));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(7);
  });
});
