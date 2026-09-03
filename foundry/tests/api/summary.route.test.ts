import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Do the thing",
    linearIssueTitle: "The Thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-42",
    repo: "test/repo",
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
    latestArtifactVersion: 4,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function makeArtifact(type: string, payloadJson: unknown, version = 1) {
  return { id: `art-${type}`, runId: "run-1", type, version, payloadJson, rawText: "", createdAt: new Date() };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn().mockResolvedValue(null) };
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
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("includes the trimmed run summary fields, including the nested linearIssue object", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { run: Record<string, unknown> };
    expect(body.run).toMatchObject({
      id: "run-1",
      state: RunState.Implementing,
      repo: "test/repo",
      branchName: "feature/thing",
      prNumber: 7,
      planVersion: 2,
      approvedPlanVersion: 2,
      linearIssue: {
        id: "LIN-1",
        identifier: "ENG-42",
        title: "The Thing",
        url: "https://linear.app/team/issue/ENG-42",
        description: "Do the thing",
      },
      linearIssueId: "LIN-1",
      linearIssueTitle: "The Thing",
      linearIssueUrl: "https://linear.app/team/issue/ENG-42",
    });
  });

  it("shapes plan payload: openQuestions default, stepCount, mapped steps, and string risks passthrough", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return makeArtifact(
          "Plan",
          {
            summary: "Add the feature",
            confidence: 0.9,
            steps: [
              { id: "s1", title: "Step 1", description: "Do step 1", extra: "dropped" },
            ],
            risks: ["risk as plain string"],
            testPlan: "run the tests",
          },
          3,
        );
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: Record<string, unknown> };
    expect(body.plan).toMatchObject({
      version: 3,
      summary: "Add the feature",
      confidence: 0.9,
      openQuestions: [],
      stepCount: 1,
      steps: [{ id: "s1", title: "Step 1", description: "Do step 1" }],
      risks: ["risk as plain string"],
      riskCount: 1,
      testPlan: "run the tests",
    });
  });

  it("shapes risk objects with a description field into their description text", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return makeArtifact("Plan", {
          risks: [{ description: "Might break auth", severity: "high" }],
        });
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["Might break auth"]);
  });

  it("JSON-stringifies risk objects that have no description field", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return makeArtifact("Plan", {
          risks: [{ severity: "high", likelihood: "low" }],
        });
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([JSON.stringify({ severity: "high", likelihood: "low" })]);
  });

  it("falls back to String(r) for a risk object that JSON.stringify cannot serialize (circular reference)", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const circular: Record<string, unknown> = { severity: "high" };
    circular.self = circular; // makes JSON.stringify throw

    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return makeArtifact("Plan", { risks: [circular] });
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([String(circular)]);
    expect(body.plan.risks[0]).toBe("[object Object]");
  });

  it("defaults stepCount/steps/risks to empty when the fields are missing entirely", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return makeArtifact("Plan", { summary: "No steps yet" });
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { stepCount: number; steps: unknown[]; risks: unknown[]; riskCount: number } };
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review payloads when those artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "PlanReview") return makeArtifact("PlanReview", { verdict: "approve" }, 2);
      if (type === "Review") return makeArtifact("Review", { verdict: "needs_changes" }, 1);
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 2, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "needs_changes" } });
  });

  it("uses the executionReport's own executionVersion when present, else falls back to artifact.version", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return makeArtifact(
          "ExecutionReport",
          { executionVersion: 5, score: 0.8, scoreRationale: "solid" },
          9,
        );
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score: number; scoreRationale: string };
    };
    expect(body.executionReport).toMatchObject({
      version: 9,
      executionVersion: 5,
      score: 0.8,
      scoreRationale: "solid",
    });
  });

  it("falls back executionVersion to artifact.version when payload has no executionVersion field", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return makeArtifact("ExecutionReport", { score: 0.4 }, 6);
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { executionReport: { version: number; executionVersion: number } };
    expect(body.executionReport.version).toBe(6);
    expect(body.executionReport.executionVersion).toBe(6);
  });

  it("handles an ExecutionReport artifact with a null payloadJson", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return makeArtifact("ExecutionReport", null, 1);
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { executionReport: { version: number; executionVersion: number } };
    expect(body.executionReport.version).toBe(1);
    expect(body.executionReport.executionVersion).toBe(1);
  });
});
