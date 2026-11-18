import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-7",
    linearIssueDescription: "Add OAuth login",
    linearIssueTitle: "Add OAuth login",
    linearIssueUrl: "https://linear.app/team/issue/ENG-7",
    repo: "test/repo",
    branchName: "feature/oauth",
    prNumber: 42,
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

async function buildApp(opts: {
  run?: ReturnType<typeof makeRun> | null;
  artifactsByType?: Record<string, unknown>;
} = {}) {
  const run = opts.run === undefined ? makeRun() : opts.run;
  const artifactsByType = opts.artifactsByType ?? {};

  const mockRunRepo = { findById: vi.fn().mockResolvedValue(run), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) =>
      Promise.resolve(artifactsByType[type] ?? null),
    ),
  };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]) };

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

  return { app };
}

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns null plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app } = await buildApp();

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
    expect(body.run.linearIssue.identifier).toBe("ENG-7");
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("maps a full plan, with string and object risks, steps and open questions", async () => {
    const circular: Record<string, unknown> = { description: "circular risk" };
    const plan = {
      summary: "Implements OAuth login",
      confidence: 0.8,
      openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
      steps: [
        { id: "s1", title: "Add route", description: "Add /login route" },
        { id: "s2", title: "Add tests", description: "Cover the new route" },
      ],
      risks: [
        "Plain string risk",
        { description: "Object risk with description" },
        { note: "Object risk without description" },
        circular,
        42,
      ],
      testPlan: "Run the OAuth integration suite",
    };

    const { app } = await buildApp({
      artifactsByType: { Plan: makeArtifact("Plan", 2, plan) },
    });

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
        openQuestions: unknown[];
      };
    };
    expect(body.plan.version).toBe(2);
    expect(body.plan.summary).toBe("Implements OAuth login");
    expect(body.plan.confidence).toBe(0.8);
    expect(body.plan.stepCount).toBe(2);
    expect(body.plan.steps).toEqual([
      { id: "s1", title: "Add route", description: "Add /login route" },
      { id: "s2", title: "Add tests", description: "Cover the new route" },
    ]);
    expect(body.plan.testPlan).toBe("Run the OAuth integration suite");
    expect(body.plan.openQuestions).toHaveLength(1);
    expect(body.plan.riskCount).toBe(5);
    expect(body.plan.risks[0]).toBe("Plain string risk");
    expect(body.plan.risks[1]).toBe("Object risk with description");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ note: "Object risk without description" }));
    // Circular risk falls back to JSON.stringify since it has a description field,
    // taking priority before the circularity would even matter.
    expect(body.plan.risks[3]).toBe("circular risk");
    expect(body.plan.risks[4]).toBe("42");
  });

  it("falls back to String(r) when a risk object has no description and cannot be JSON.stringified", async () => {
    const circular: Record<string, unknown> = { note: "unresolvable" };
    circular.self = circular; // circular reference, no 'description' field

    const plan = { risks: [circular] };
    const { app } = await buildApp({
      artifactsByType: { Plan: makeArtifact("Plan", 1, plan) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["[object Object]"]);
  });

  it("defaults riskTexts to [] when plan.risks is not an array, and steps to [] when plan.steps is not an array", async () => {
    const plan = { summary: "No risks or steps tracked" };
    const { app } = await buildApp({
      artifactsByType: { Plan: makeArtifact("Plan", 1, plan) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      plan: { risks: string[]; riskCount: number; steps: unknown[]; stepCount: number; openQuestions: unknown[] };
    };
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.openQuestions).toEqual([]);
  });

  it("includes planReview and review payloads when present", async () => {
    const { app } = await buildApp({
      artifactsByType: {
        PlanReview: makeArtifact("PlanReview", 1, { approved: true, comments: "lgtm" }),
        Review: makeArtifact("Review", 3, { approved: false, comments: "needs work" }),
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
    };
    expect(body.planReview).toEqual({ version: 1, payload: { approved: true, comments: "lgtm" } });
    expect(body.review).toEqual({ version: 3, payload: { approved: false, comments: "needs work" } });
  });

  it("maps executionReport fields from the payload when present", async () => {
    const payload = { executionVersion: 5, score: 0.9, scoreRationale: "Clean diff" };
    const { app } = await buildApp({
      artifactsByType: { ExecutionReport: makeArtifact("ExecutionReport", 4, payload) },
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
    expect(body.executionReport).toEqual({
      version: 4,
      executionVersion: 5,
      score: 0.9,
      scoreRationale: "Clean diff",
      payload,
    });
  });

  it("falls back executionVersion to the artifact version when the payload is null", async () => {
    const { app } = await buildApp({
      artifactsByType: { ExecutionReport: makeArtifact("ExecutionReport", 7, null) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executionReport: {
        version: number;
        executionVersion: number;
        score: unknown;
        scoreRationale: unknown;
        payload: unknown;
      };
    };
    expect(body.executionReport.version).toBe(7);
    expect(body.executionReport.executionVersion).toBe(7);
    expect(body.executionReport.score).toBeUndefined();
    expect(body.executionReport.scoreRationale).toBeUndefined();
    expect(body.executionReport.payload).toBeNull();
  });
});
