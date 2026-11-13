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
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
    repo: "test-repo",
    branchName: "feature/x",
    prNumber: 7,
    state: RunState.AIReview,
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
  return { id: `art-${type}-${version}`, runId: "run-1", type, version, payloadJson, rawText: "", createdAt: new Date() };
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

  it("returns run info with null plan/review/executionReport when no artifacts exist", async () => {
    const run = makeRun();
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      run: { id: string; state: string; linearIssue: { identifier: string } };
      plan: unknown;
      planReview: unknown;
      review: unknown;
      executionReport: unknown;
    };
    expect(body.run.id).toBe("run-1");
    expect(body.run.state).toBe(RunState.AIReview);
    expect(body.run.linearIssue.identifier).toBe("ENG-1");
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("maps plan risks given as plain strings", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 2, {
            summary: "Do the thing",
            confidence: 0.8,
            openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Step 1", description: "First step" }],
            risks: ["Risk as plain string"],
            testPlan: "Run unit tests",
          }),
        );
      }
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
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.risks).toEqual(["Risk as plain string"]);
    expect(body.plan.riskCount).toBe(1);
  });

  it("maps plan risks given as { description } objects", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 1, {
            summary: "s",
            confidence: 0.5,
            openQuestions: [],
            steps: [],
            risks: [{ description: "Risk as object" }],
            testPlan: "tp",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["Risk as object"]);
  });

  it("falls back to JSON.stringify for an unrecognized risk shape", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 1, {
            summary: "s",
            confidence: 0.5,
            openQuestions: [],
            steps: [],
            risks: [{ oddShape: true }],
            testPlan: "tp",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([JSON.stringify({ oddShape: true })]);
  });

  it("returns empty risks/steps when plan.risks or plan.steps are absent", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 1, {
            summary: "s",
            confidence: 0.5,
            testPlan: "tp",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[]; riskCount: number; steps: unknown[]; stepCount: number } };
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
  });

  it("includes planReview and review payloads when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", 1, { verdict: "approved" }));
      if (type === "Review") return Promise.resolve(makeArtifact("Review", 1, { overallVerdict: "approved" }));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      planReview: { version: number; payload: { verdict: string } } | null;
      review: { version: number; payload: { overallVerdict: string } } | null;
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 1, payload: { overallVerdict: "approved" } });
  });

  it("includes executionReport summary fields when present, using executionVersion from payload", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(
          makeArtifact("ExecutionReport", 3, {
            executionVersion: 5,
            score: 0.95,
            scoreRationale: "All checks passed",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      executionReport: {
        version: number;
        executionVersion: number;
        score: number;
        scoreRationale: string;
      } | null;
    };
    expect(body.executionReport).toMatchObject({
      version: 3,
      executionVersion: 5,
      score: 0.95,
      scoreRationale: "All checks passed",
    });
  });

  it("falls back to the artifact's version as executionVersion when payload lacks one", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(makeArtifact("ExecutionReport", 2, null));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { executionReport: { version: number; executionVersion: number } | null };
    expect(body.executionReport?.version).toBe(2);
    expect(body.executionReport?.executionVersion).toBe(2);
  });
});
