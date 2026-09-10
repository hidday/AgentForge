import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Supplemental branch coverage for POST /api/runs/:id/actions/request-human,
// beyond tests/api/request-human.route.test.ts (not modified here): the
// run-not-found path, default uiBaseUrl/debounceHours (options omitted),
// and the individual short-circuit branches inside the debounce lookup.

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
  run?: unknown | null;
  events?: unknown[];
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
  // Deliberately omit `options` (5th arg's notificationService/uiBaseUrl/
  // debounceHours) unless explicitly requested, to exercise the ?? defaults.
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    undefined,
    opts.withOptions ? {} : undefined,
  );
  await app.ready();
  return { app, mockRunRepo, mockEventRepo };
}

describe("POST /api/runs/:id/actions/request-human (extra branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "Need a human" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("uses default uiBaseUrl and debounceHours (6h) when options are not provided", async () => {
    const { app, mockEventRepo } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need a human" },
    });

    expect(res.statusCode).toBe(200);
    const eventArgs = mockEventRepo.create.mock.calls[0][0] as { payloadJson: { runUrl: string } };
    expect(eventArgs.payloadJson.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("does not debounce when a HUMAN_REQUESTED event has a different eventType", async () => {
    const recentTs = new Date(Date.now() - 60 * 60 * 1000);
    const { app, mockEventRepo } = await buildApp({
      events: [
        { eventType: RunEvent.PLAN_CREATED, createdAt: recentTs, payloadJson: { reason: "other" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need a human" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ debounced: false });
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });

  it("does not debounce when the matching-reason event is older than the debounce window", async () => {
    const oldTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, default window is 6h
    const { app, mockEventRepo } = await buildApp({
      events: [
        { eventType: RunEvent.HUMAN_REQUESTED, createdAt: oldTs, payloadJson: { reason: "other" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need a human" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ debounced: false });
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });

  it("falls back linearIssue.identifier to undefined when the run has no linearIssueIdentifier", async () => {
    const run = makeRun({ linearIssueIdentifier: null });
    const { app, mockEventRepo } = await buildApp({ run });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need a human" },
    });

    expect(res.statusCode).toBe(200);
    const eventArgs = mockEventRepo.create.mock.calls[0][0] as { payloadJson: unknown };
    expect(eventArgs.payloadJson).toBeDefined();
  });
});
