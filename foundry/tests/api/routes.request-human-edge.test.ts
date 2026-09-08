import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Covers request-human route branches the primary request-human.route.test.ts
// suite doesn't reach: the run-not-found guard, the default uiBaseUrl /
// debounceHours option values, a null linearIssueIdentifier, an event list
// that includes a non-HUMAN_REQUESTED event (mismatch branch of the debounce
// filter), and a HUMAN_REQUESTED event that is older than the debounce
// window (so it should NOT suppress a new notification).

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
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
  notificationOptions?: Record<string, unknown>;
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
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

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
    { notificationService: notificationService as never, ...opts.notificationOptions },
  );
  await app.ready();

  return { app, mockRunRepo, mockEventRepo, sendHumanRequest };
}

describe("POST /api/runs/:id/actions/request-human edge branches", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("uses the default uiBaseUrl (localhost:5173) and debounceHours (6) when options are omitted", async () => {
    const { app, sendHumanRequest } = await buildApp({ notificationOptions: {} });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need help please" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { runUrl: string };
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("maps a null linearIssueIdentifier to undefined in the notification payload", async () => {
    const run = makeRun({ linearIssueIdentifier: null });
    const { app, sendHumanRequest } = await buildApp({ run });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need help please" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as {
      linearIssue: { identifier?: string };
    };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });

  it("does not debounce when the event history contains a non-HUMAN_REQUESTED event", async () => {
    const { app, sendHumanRequest } = await buildApp({
      events: [
        {
          eventType: RunEvent.RUN_REQUESTED,
          createdAt: new Date(),
          payloadJson: {},
        },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need help please" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("does not debounce when the matching HUMAN_REQUESTED event is older than the debounce window", async () => {
    const staleTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, beyond the default 6h window
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
      payload: { reason: "other", summary: "Need help please" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });
});
