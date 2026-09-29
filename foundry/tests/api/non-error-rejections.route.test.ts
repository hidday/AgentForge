import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Every action route stringifies a caught error with
// `err instanceof Error ? err.message : String(err)`. The other route test
// files only ever reject with real Error instances, leaving the non-Error
// branch of that ternary uncovered. These tests throw/reject with plain
// strings to exercise the String(err) fallback across the handlers.

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
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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

  return { app, mockRunRepo };
}

describe("non-Error rejection handling across action routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approve-plan stringifies a non-Error rejection", async () => {
    const { app } = await buildApp({
      approvePlan: vi.fn().mockRejectedValue("plain string failure"),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("reject-plan stringifies a non-Error rejection", async () => {
    const { app } = await buildApp({
      rejectPlan: vi.fn().mockRejectedValue("plain string failure"),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("re-review-plan stringifies a non-Error synchronous throw", async () => {
    const { app } = await buildApp({
      runManualReReview: vi.fn().mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal -- exercising the String(err) fallback branch
        throw "plain string failure";
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("approve-review stringifies a non-Error rejection", async () => {
    const { app } = await buildApp({
      approveHumanReview: vi.fn().mockRejectedValue("plain string failure"),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("pause stringifies a non-Error rejection", async () => {
    const { app, mockRunRepo } = await buildApp({
      handleCommand: vi.fn().mockRejectedValue("plain string failure"),
    });
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("resume stringifies a non-Error rejection", async () => {
    const { app, mockRunRepo } = await buildApp({
      handleCommand: vi.fn().mockRejectedValue("plain string failure"),
    });
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("answer-questions stringifies a non-Error, non-PolicyError, non-ValidationError rejection", async () => {
    const { app } = await buildApp({
      answerQuestions: vi.fn().mockRejectedValue("plain string failure"),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("GET /api/linear/* — non-Error rejection handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/linear/pending stringifies a non-Error rejection", async () => {
    const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
    const mockArtifactRepo = { findByRunId: vi.fn() };
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
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue("plain string failure"),
    };

    const app = Fastify({ logger: false });
    registerApiRoutes(
      app,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
      linearPollService as never,
    );
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("POST /api/linear/ingest stringifies a non-Error rejection", async () => {
    const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
    const mockArtifactRepo = { findByRunId: vi.fn() };
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
    const linearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue("plain string failure"),
    };

    const app = Fastify({ logger: false });
    registerApiRoutes(
      app,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
      linearPollService as never,
    );
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});
