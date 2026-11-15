import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

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
    state: RunState.AwaitingPlanApproval,
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
  const mockArtifactRepo = {
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
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
  return { app, mockRunRepo, mockArtifactRepo };
}

describe("POST /api/runs/:id/actions/re-review-plan — synchronous throw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when runManualReReview throws synchronously instead of rejecting", async () => {
    const { app } = await buildApp({
      runManualReReview: vi.fn(() => {
        throw new Error("cannot start re-review synchronously");
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot start re-review synchronously" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan — synchronous throw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when runManualPlanRevision throws synchronously instead of rejecting", async () => {
    const { app } = await buildApp({
      runManualPlanRevision: vi.fn(() => {
        throw new Error("cannot start revision synchronously");
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot start revision synchronously" });
  });
});

describe("GET /api/runs/:id/summary — risk serialization fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to String(r) when a non-string, description-less risk can't be JSON.stringify'd (circular ref)", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: Record<string, unknown> = { severity: "high" };
    circular.self = circular;

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "art-plan",
          runId: run.id,
          type: "Plan",
          version: 1,
          payloadJson: { risks: [circular] },
          rawText: "",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual(["[object Object]"]);
  });
});

async function buildAppWithLinearPoll(linearPollService: Record<string, unknown>) {
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
  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    linearPollService as never,
  );
  await app.ready();
  return { app };
}

describe("GET /api/linear/pending — non-Error rejection", () => {
  it("falls back to String(err) when discoverPendingIssues rejects with a non-Error value", async () => {
    const { app } = await buildAppWithLinearPoll({
      discoverPendingIssues: vi.fn().mockRejectedValue("plain string failure"),
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/linear/ingest — non-Error rejection", () => {
  it("falls back to String(err) when startRunsForIssues rejects with a non-Error value", async () => {
    const { app } = await buildAppWithLinearPoll({
      startRunsForIssues: vi.fn().mockRejectedValue("plain string failure"),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["iss-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });
});

describe("POST /api/runs/:id/actions/request-human — identifier fallback", () => {
  it("omits identifier (undefined) when linearIssueIdentifier is null", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, linearIssueIdentifier: null });
    const mockRunRepo = { findById: vi.fn().mockResolvedValue(run), findAll: vi.fn() };
    const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn().mockResolvedValue(null) };
    const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) };
    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => mockArtifactRepo,
      getEventRepo: () => mockEventRepo,
    };
    const sendHumanRequest = vi.fn().mockResolvedValue({
      slack: { attempted: true, ok: true },
      email: { attempted: false, ok: false },
    });
    const notificationService = { isConfigured: () => true, sendHumanRequest };
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
      undefined,
      { notificationService: notificationService as never },
    );
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "manual flag" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { linearIssue: { identifier?: string } };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });
});
