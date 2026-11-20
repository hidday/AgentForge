import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// This file covers branches of POST /api/runs/:id/actions/request-human not
// exercised by tests/api/request-human.route.test.ts: the 404 (run not
// found), the default debounceHours/uiBaseUrl option values, a stale
// (outside the debounce window) prior event, a prior event of an unrelated
// eventType, and a run with a null linearIssueIdentifier.

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
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

interface BuildAppOptions {
  run?: unknown | null;
  existingEvents?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
}

async function buildApp(opts: BuildAppOptions = {}) {
  const run = opts.run === undefined ? makeRun() : opts.run;

  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(run),
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
    // `withOptions: false` omits debounceHours/uiBaseUrl specifically (to hit their
    // `?? default` branches) while still providing a notificationService, since
    // the notification branch itself is covered by request-human.route.test.ts.
    { notificationService: notificationService as never },
  );
  await app.ready();

  return { app, mockEventRepo, sendHumanRequest, mockRunRepo };
}

describe("POST /api/runs/:id/actions/request-human (additional branch coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run is not found", async () => {
    const { app } = await buildApp({ run: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "hi" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("uses the default debounceHours (6) and uiBaseUrl when those options are omitted", async () => {
    const { app, sendHumanRequest } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Needs attention" },
    });

    expect(res.statusCode).toBe(200);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
    const payload = sendHumanRequest.mock.calls[0][0] as { runUrl: string };
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("does not debounce when the only prior HUMAN_REQUESTED-reason event is outside the debounce window", async () => {
    const staleTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, default window is 6h
    const { app, sendHumanRequest } = await buildApp({
      existingEvents: [
        { eventType: RunEvent.HUMAN_REQUESTED, createdAt: staleTs, payloadJson: { reason: "plan_ambiguous" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Still unclear" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { debounced: boolean }).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("skips over unrelated event types when checking for a recent HUMAN_REQUESTED event", async () => {
    const recentTs = new Date(Date.now() - 60 * 1000);
    const { app, sendHumanRequest } = await buildApp({
      existingEvents: [
        { eventType: RunEvent.PLAN_CREATED, createdAt: recentTs, payloadJson: { reason: "plan_ambiguous" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "First request" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { debounced: boolean }).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("sends linearIssue.identifier as undefined when the run's linearIssueIdentifier is null", async () => {
    const { app, sendHumanRequest } = await buildApp({
      run: makeRun({ linearIssueIdentifier: null }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "No linear identifier on this run" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { linearIssue: { identifier?: string } };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });
});
