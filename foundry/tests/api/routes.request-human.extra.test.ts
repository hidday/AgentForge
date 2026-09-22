import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

/**
 * Extra coverage for POST /api/runs/:id/actions/request-human — branches
 * not exercised by tests/api/request-human.route.test.ts: run-not-found,
 * default debounceHours/uiBaseUrl, a null linearIssueIdentifier, an
 * existing event with a different eventType, and an existing
 * HUMAN_REQUESTED event that is outside the debounce window.
 */

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

interface BuildAppOptions {
  run?: ReturnType<typeof makeRun> | null;
  existingEvents?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
  debounceHours?: number;
  uiBaseUrl?: string;
}

async function buildApp(opts: BuildAppOptions = {}) {
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

  const notificationService = {
    isConfigured: () => false,
    sendHumanRequest: vi.fn(),
  };

  const options: Record<string, unknown> = { notificationService };
  if (opts.debounceHours !== undefined) options.debounceHours = opts.debounceHours;
  if (opts.uiBaseUrl !== undefined) options.uiBaseUrl = opts.uiBaseUrl;

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    undefined,
    options,
  );
  await app.ready();

  return { app, mockEventRepo };
}

describe("POST /api/runs/:id/actions/request-human — extra branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hello" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("defaults debounceHours to 6 and uiBaseUrl to localhost when options are not provided", async () => {
    const { app, mockEventRepo } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Defaults check" },
    });

    expect(response.statusCode).toBe(200);
    const eventArgs = mockEventRepo.create.mock.calls[0][0] as { payloadJson: { runUrl: string } };
    expect(eventArgs.payloadJson.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("stores identifier as undefined (not null) in the notification payload when linearIssueIdentifier is null", async () => {
    const run = makeRun({ linearIssueIdentifier: null });
    const notificationService = {
      isConfigured: () => true,
      sendHumanRequest: vi
        .fn()
        .mockResolvedValue({ slack: { attempted: true, ok: true }, email: { attempted: false, ok: false } }),
    };

    const mockRunRepo = { findById: vi.fn().mockResolvedValue(run), findAll: vi.fn() };
    const mockArtifactRepo = {
      findByRunId: vi.fn().mockResolvedValue([]),
      findLatestByType: vi.fn().mockResolvedValue(null),
    };
    const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) };
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
    registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never, undefined, {
      notificationService: notificationService as never,
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "identifier null check" },
    });

    expect(response.statusCode).toBe(200);
    const payload = notificationService.sendHumanRequest.mock.calls[0][0] as {
      linearIssue: { identifier?: string };
    };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });

  it("does not debounce when an existing event has a different eventType", async () => {
    const recentTs = new Date(Date.now() - 60 * 60 * 1000);
    const { app } = await buildApp({
      existingEvents: [
        { eventType: "SOME_OTHER_EVENT", createdAt: recentTs, payloadJson: { reason: "other" } },
      ],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "not debounced by unrelated event" },
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { debounced: boolean }).debounced).toBe(false);
  });

  it("does not debounce when the matching HUMAN_REQUESTED event is outside the debounce window", async () => {
    const oldTs = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
    const { app } = await buildApp({
      debounceHours: 1,
      existingEvents: [
        { eventType: RunEvent.HUMAN_REQUESTED, createdAt: oldTs, payloadJson: { reason: "other" } },
      ],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "old event should not debounce" },
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { debounced: boolean }).debounced).toBe(false);
  });
});
