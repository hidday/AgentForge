import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

/**
 * Covers branches of the request-human route not exercised by the existing
 * request-human.route.test.ts: the 404 path, the default debounceHours/
 * uiBaseUrl fallbacks (no options passed), events filtered out of the
 * debounce check (wrong eventType or too old), and a run with no
 * linearIssueIdentifier.
 */
function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Add login",
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

async function buildApp(opts: {
  run?: ReturnType<typeof makeRun> | null;
  events?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
  routeOptions?: Record<string, unknown>;
} = {}) {
  const run = opts.run === undefined ? makeRun() : opts.run;

  const mockRunRepo = { findById: vi.fn().mockResolvedValue(run), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue(opts.events ?? []),
    create: vi.fn().mockResolvedValue({}),
  };

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
    undefined,
    opts.routeOptions ?? {},
  );
  await app.ready();

  return { app, mockEventRepo };
}

describe("POST /api/runs/:id/actions/request-human — additional branches", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "Need help" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("uses default debounceHours (6) and default uiBaseUrl when neither option is configured", async () => {
    const { app } = await buildApp({ routeOptions: {} });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need help" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; debounced: boolean };
    expect(body.ok).toBe(true);
    expect(body.debounced).toBe(false);
  });

  it("does not debounce when a HUMAN_REQUESTED event exists but has a different eventType filtered branch (non-matching type)", async () => {
    const { app, mockEventRepo } = await buildApp({
      events: [
        {
          eventType: "STATE_CHANGED",
          createdAt: new Date(),
          payloadJson: { reason: "other" },
        },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need help" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ debounced: false });
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });

  it("does not debounce when the matching HUMAN_REQUESTED event is older than the debounce window", async () => {
    const oldTs = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10h ago, outside default 6h window
    const { app, mockEventRepo } = await buildApp({
      events: [
        {
          eventType: RunEvent.HUMAN_REQUESTED,
          createdAt: oldTs,
          payloadJson: { reason: "other" },
        },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need help" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ debounced: false });
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });

  it("passes undefined identifier through when run.linearIssueIdentifier is null", async () => {
    const { app } = await buildApp({
      run: makeRun({ linearIssueIdentifier: null }),
      routeOptions: {
        notificationService: {
          isConfigured: () => true,
          sendHumanRequest: vi.fn().mockResolvedValue({
            slack: { attempted: true, ok: true },
            email: { attempted: false, ok: false },
          }),
        },
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need help" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, debounced: false });
  });
});
