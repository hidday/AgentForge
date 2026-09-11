import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// These routes each normalize a caught error with the pattern
// `err instanceof Error ? err.message : String(err)`. The existing
// route-specific test files only ever reject/throw real Error instances,
// leaving the non-Error branch of that ternary uncovered. These tests
// throw/reject with plain values (a string, a number) to exercise that
// fallback branch and confirm the response still degrades gracefully.

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function buildApp(orchestratorOverrides: Record<string, unknown> = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
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
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    retryRun: vi.fn(),
    ...orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo };
}

describe("routes.ts non-Error rejection/throw branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approve-plan: stringifies a non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue("plain string rejection");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string rejection" });
  });

  it("reject-plan: stringifies a non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockRejectedValue(42);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "42" });
  });

  it("re-review-plan: stringifies a non-Error synchronous throw", async () => {
    const { app } = await buildApp({
      runManualReReview: vi.fn(() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "not an Error instance";
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "not an Error instance" });
  });

  it("revise-plan: stringifies a non-Error synchronous throw", async () => {
    const { app } = await buildApp({
      runManualPlanRevision: vi.fn(() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "not an Error instance";
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "not an Error instance" });
  });

  it("approve-review: stringifies a non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue({ code: "E_BAD" });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "[object Object]" });
  });

  it("pause: stringifies a non-Error rejection from handleCommand", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue("pause failed");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "pause failed" });
  });

  it("resume: stringifies a non-Error rejection from handleCommand", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue("resume failed");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "resume failed" });
  });
});
