import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-7",
    linearIssueDescription: "Fix the thing",
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: "https://linear.app/team/issue/ENG-7",
    repo: "acme/widgets",
    branchName: "ai/eng-7",
    prNumber: 42,
    state: RunState.Done,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    ...overrides,
  };
}

function artifact(type: string, version: number, payloadJson: unknown) {
  return { id: `art-${type}-${version}`, runId: "run-1", type, version, payloadJson, rawText: "", createdAt: new Date() };
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
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      run: { id: string; linearIssue: { identifier: string | null } };
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

  it("maps the plan artifact including string risks and step/question shapes", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          artifact("Plan", 2, {
            summary: "Add a login form",
            confidence: 0.8,
            openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Build form", description: "React form", extra: "dropped" }],
            risks: ["could break SSO"],
            testPlan: "manual QA",
          }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: Record<string, unknown> };
    expect(body.plan).toMatchObject({
      version: 2,
      summary: "Add a login form",
      confidence: 0.8,
      stepCount: 1,
      steps: [{ id: "s1", title: "Build form", description: "React form" }],
      risks: ["could break SSO"],
      riskCount: 1,
      testPlan: "manual QA",
    });
    expect(body.plan.openQuestions).toEqual([
      { id: "q1", question: "Which provider?", requiredForExecution: true },
    ]);
  });

  it("stringifies object-shaped risks that lack a description field", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(artifact("Plan", 1, { risks: [{ severity: "high" }, 42] }));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([JSON.stringify({ severity: "high" }), "42"]);
  });

  it("extracts a description field from object-shaped risks when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(artifact("Plan", 1, { risks: [{ description: "data loss risk" }] }));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["data loss risk"]);
  });

  it("defaults steps/openQuestions/risks to empty when the plan payload omits them", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(artifact("Plan", 1, { summary: "bare plan" }));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { plan: { steps: unknown[]; openQuestions: unknown[]; risks: unknown[]; riskCount: number } };
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });

  it("includes planReview and review artifacts verbatim when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve(artifact("PlanReview", 1, { verdict: "approve" }));
      if (type === "Review") return Promise.resolve(artifact("Review", 3, { verdict: "pass" }));
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 3, payload: { verdict: "pass" } });
  });

  it("derives executionVersion from the artifact version when the payload omits it", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(artifact("ExecutionReport", 5, { score: 0.9 }));
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as {
      executionReport: { version: number; executionVersion: number; score: number; scoreRationale?: string };
    };
    expect(body.executionReport.version).toBe(5);
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBe(0.9);
  });

  it("prefers an explicit executionVersion from the payload over the artifact version", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve(
          artifact("ExecutionReport", 5, { executionVersion: 2, score: 0.5, scoreRationale: "flaky tests" }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json() as { executionReport: { executionVersion: number; scoreRationale: string } };
    expect(body.executionReport.executionVersion).toBe(2);
    expect(body.executionReport.scoreRationale).toBe("flaky tests");
  });
});
