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
    linearIssueUrl: "https://linear.app/x",
    repo: "test-repo",
    branchName: "ai/eng-1",
    prNumber: 7,
    state: RunState.Implementing,
    planVersion: 2,
    approvedPlanVersion: 1,
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
  const mockRunRepo = { findById: vi.fn() };
  const mockArtifactRepo = { findLatestByType: vi.fn().mockResolvedValue(null) };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
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
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns plan:null, planReview:null, review:null, executionReport:null when no artifacts exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect((body.run as { linearIssue: { identifier: string } }).linearIssue.identifier).toBe(
      "ENG-1",
    );
  });

  it("maps a Plan artifact: steps, string risks, and object risks with description", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return makeArtifact("Plan", 3, {
          summary: "Do the thing",
          confidence: 0.8,
          openQuestions: [{ id: "q1", question: "Why?", requiredForExecution: true }],
          steps: [{ id: "s1", title: "Step 1", description: "First step" }],
          risks: ["plain risk string", { description: "object risk" }],
          testPlan: "run tests",
        });
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: Record<string, unknown> };
    expect(body.plan.version).toBe(3);
    expect(body.plan.summary).toBe("Do the thing");
    expect(body.plan.confidence).toBe(0.8);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "First step" }]);
    expect(body.plan.risks).toEqual(["plain risk string", "object risk"]);
    expect(body.plan.riskCount).toBe(2);
    expect(body.plan.testPlan).toBe("run tests");
  });

  it("stringifies a risk object with no description via JSON.stringify", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return makeArtifact("Plan", 1, {
          summary: "s",
          risks: [{ severity: "high" }],
        });
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([JSON.stringify({ severity: "high" })]);
  });

  it("falls back to String(r) when a risk is a circular object JSON.stringify can't serialize", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return makeArtifact("Plan", 1, { summary: "s", risks: [circular] });
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks[0]).toBe(String(circular));
  });

  it("defaults stepCount/steps/openQuestions when steps/openQuestions are absent", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") return makeArtifact("Plan", 1, { summary: "s" });
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { stepCount: number; steps: unknown[]; openQuestions: unknown[]; risks: unknown[] } };
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.risks).toEqual([]);
  });

  it("includes planReview and review payloads when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "PlanReview") return makeArtifact("PlanReview", 1, { verdict: "approved" });
      if (type === "Review") return makeArtifact("Review", 2, { verdict: "changes_requested" });
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 2, payload: { verdict: "changes_requested" } });
  });

  it("includes executionReport with explicit executionVersion/score/scoreRationale", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return makeArtifact("ExecutionReport", 5, {
          executionVersion: 9,
          score: 0.95,
          scoreRationale: "all checks passed",
        });
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score: number; scoreRationale: string };
    };
    expect(body.executionReport.version).toBe(5);
    expect(body.executionReport.executionVersion).toBe(9);
    expect(body.executionReport.score).toBe(0.95);
    expect(body.executionReport.scoreRationale).toBe("all checks passed");
  });

  it("defaults executionVersion to the artifact version when payload omits it", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "ExecutionReport") return makeArtifact("ExecutionReport", 4, null);
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { executionReport: { executionVersion: number; score?: number } };
    expect(body.executionReport.executionVersion).toBe(4);
    expect(body.executionReport.score).toBeUndefined();
  });
});
