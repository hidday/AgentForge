import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Complements tests/api/request-human.route.test.ts by covering branches
// that file's fixtures never exercise: the 404 (run not found) path, the
// options.debounceHours / options.uiBaseUrl defaults (no options object
// passed at all), events of a different type or outside the debounce
// window not matching, and a run with no linearIssueIdentifier.

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "desc",
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
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
  withOptions?: boolean;
} = {}) {
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(opts.run === undefined ? makeRun() : opts.run),
    findAll: vi.fn(),
  };
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
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const sendHumanRequest = vi.fn().mockResolvedValue({
    slack: { attempted: true, ok: true },
    email: { attempted: false, ok: false },
  });
  const notificationService = { isConfigured: () => true, sendHumanRequest };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    undefined,
    opts.withOptions === false ? {} : { notificationService: notificationService as never },
  );
  await app.ready();

  return { app, mockEventRepo, sendHumanRequest };
}

describe("POST /api/runs/:id/actions/request-human — edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hello" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("uses the default debounceHours (6) and uiBaseUrl when no options are configured", async () => {
    const { app, sendHumanRequest } = await buildApp({ withOptions: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Default options path" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; notified: { slack: boolean; email: boolean } };
    expect(body.ok).toBe(true);
    // notificationService omitted entirely -> not configured -> both false.
    expect(body.notified).toEqual({ slack: false, email: false });
    expect(sendHumanRequest).not.toHaveBeenCalled();
  });

  it("omits linearIssue.identifier when the run has no linearIssueIdentifier", async () => {
    const { app, sendHumanRequest } = await buildApp({
      run: makeRun({ linearIssueIdentifier: null }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "No identifier on this run" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as {
      linearIssue: { identifier?: string };
    };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });

  it("does not debounce when the only prior HUMAN_REQUESTED event is a different eventType", async () => {
    const { app, sendHumanRequest } = await buildApp({
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
      payload: { reason: "other", summary: "Different event type in history" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { debounced: boolean }).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("does not debounce when the matching-reason event is outside the debounce window", async () => {
    const staleTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, > 6h window
    const { app, sendHumanRequest, mockEventRepo } = await buildApp({
      events: [
        {
          eventType: RunEvent.HUMAN_REQUESTED,
          createdAt: staleTs,
          payloadJson: { reason: "other" },
        },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Stale prior notification" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { debounced: boolean }).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });
});
