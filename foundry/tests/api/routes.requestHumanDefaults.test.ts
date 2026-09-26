import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Supplements tests/api/request-human.route.test.ts by covering branches that
// file doesn't exercise: the default uiBaseUrl/debounceHours fallbacks (when
// registerApiRoutes is called without those options), a null
// linearIssueIdentifier, and an old HUMAN_REQUESTED event that is outside the
// debounce window (so it should NOT suppress a new notification).

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
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

interface BuildOpts {
  existingEvents?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
  withNotificationOptions?: boolean;
  runOverrides?: Record<string, unknown>;
  runNotFound?: boolean;
}

async function buildApp(opts: BuildOpts = {}) {
  const run = makeRun(opts.runOverrides);
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(opts.runNotFound ? null : run),
    findAll: vi.fn(),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue(opts.existingEvents ?? []),
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
    opts.withNotificationOptions === false ? {} : { notificationService: notificationService as never },
  );
  await app.ready();

  return { app, mockEventRepo, sendHumanRequest, run };
}

describe("POST /api/runs/:id/actions/request-human — default options and edge branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ runNotFound: true });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing-run/actions/request-human",
      payload: { reason: "other", summary: "Run does not exist" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("does not treat a non-HUMAN_REQUESTED event as a debounce match", async () => {
    const { app, sendHumanRequest } = await buildApp({
      existingEvents: [
        { eventType: "PLAN_CREATED", createdAt: new Date(), payloadJson: { reason: "other" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Unrelated prior event" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { debounced: boolean };
    expect(body.debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("defaults runUrl to http://localhost:5173 when uiBaseUrl option is not provided", async () => {
    const { app, sendHumanRequest } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "No uiBaseUrl configured" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { runUrl: string };
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("passes linearIssue.identifier as undefined when linearIssueIdentifier is null", async () => {
    const { app, sendHumanRequest } = await buildApp({ runOverrides: { linearIssueIdentifier: null } });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Null identifier" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as {
      linearIssue: { identifier?: string };
    };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });

  it("does not debounce when the matching prior HUMAN_REQUESTED event is outside the debounce window", async () => {
    // Default debounceHours is 6; this event is 7 hours old.
    const oldTs = new Date(Date.now() - 7 * 60 * 60 * 1000);
    const { app, sendHumanRequest, mockEventRepo } = await buildApp({
      existingEvents: [
        { eventType: RunEvent.HUMAN_REQUESTED, createdAt: oldTs, payloadJson: { reason: "other" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Old event, should not debounce" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { debounced: boolean };
    expect(body.debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });
});
