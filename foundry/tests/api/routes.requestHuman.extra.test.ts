import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Gap-fillers for POST /api/runs/:id/actions/request-human, complementing
// tests/api/request-human.route.test.ts. These cover: the run-not-found
// 404, the default debounceHours/uiBaseUrl fallbacks (no options passed),
// a non-HUMAN_REQUESTED event in the history, a stale HUMAN_REQUESTED
// event outside the debounce window, and a run with no linearIssueIdentifier.

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Test issue body.",
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
  existingEvents?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
  withOptions?: boolean;
} = {}) {
  const run = opts.run === undefined ? makeRun() : opts.run;

  const mockRunRepo = { findById: vi.fn().mockResolvedValue(run), findAll: vi.fn() };
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
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const sendHumanRequest = vi
    .fn()
    .mockResolvedValue({ slack: { attempted: true, ok: true }, email: { attempted: false, ok: false } });
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

describe("POST /api/runs/:id/actions/request-human (gap-filling cases)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("uses default debounceHours=6 and uiBaseUrl when no options are configured", async () => {
    const { app, sendHumanRequest } = await buildApp({ withOptions: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Needs a human" },
    });

    expect(res.statusCode).toBe(200);
    // No notificationService configured at all -> notified stays false, but
    // the route still exercises the default uiBaseUrl / debounceHours path.
    expect(sendHumanRequest).not.toHaveBeenCalled();
    const body = res.json() as { ok: boolean; notified: { slack: boolean; email: boolean } };
    expect(body.ok).toBe(true);
    expect(body.notified).toEqual({ slack: false, email: false });
  });

  it("does not debounce when the only prior event has a different eventType", async () => {
    const { app, sendHumanRequest } = await buildApp({
      existingEvents: [
        {
          eventType: "PLAN_APPROVED",
          createdAt: new Date(),
          payloadJson: { reason: "plan_ambiguous" },
        },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Needs a human" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ debounced: false });
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("does not debounce when the matching event is older than the debounce window", async () => {
    const staleTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, default window is 6h
    const { app, sendHumanRequest } = await buildApp({
      existingEvents: [
        {
          eventType: RunEvent.HUMAN_REQUESTED,
          createdAt: staleTs,
          payloadJson: { reason: "plan_ambiguous" },
        },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Needs a human again" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ debounced: false });
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("omits linearIssue.identifier when the run has no linearIssueIdentifier", async () => {
    const run = makeRun({ linearIssueIdentifier: null });
    const { app, sendHumanRequest } = await buildApp({ run });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Needs a human" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as {
      linearIssue: { identifier?: string };
    };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });
});
