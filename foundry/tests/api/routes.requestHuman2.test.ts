import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Fills gaps in tests/api/request-human.route.test.ts: the 404 branch, the
// default debounceHours/uiBaseUrl branches (options omitted), and the event
// `.find()` predicate's non-matching paths (wrong eventType / outside window).

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "Test issue",
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

describe("POST /api/runs/:id/actions/request-human — additional branches", () => {
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
  });

  it("uses default debounceHours (6) and default uiBaseUrl when options are omitted", async () => {
    const { app, sendHumanRequest } = await buildApp({ withOptions: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "manual flag" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { runUrl: string };
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("does not debounce when a HUMAN_REQUESTED event with the same reason is outside the debounce window", async () => {
    const oldTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, default window is 6h
    const { app, sendHumanRequest } = await buildApp({
      withOptions: false,
      events: [{ eventType: RunEvent.HUMAN_REQUESTED, createdAt: oldTs, payloadJson: { reason: "other" } }],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "manual flag" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { debounced: boolean }).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("skips over unrelated event types when scanning for a recent debounce match", async () => {
    const recentTs = new Date(Date.now() - 60 * 1000);
    const { app, sendHumanRequest } = await buildApp({
      withOptions: false,
      events: [
        { eventType: "PLAN_CREATED", createdAt: recentTs, payloadJson: {} },
        { eventType: RunEvent.HUMAN_REQUESTED, createdAt: recentTs, payloadJson: { reason: "plan_ambiguous" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "different reason" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { debounced: boolean }).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });
});
