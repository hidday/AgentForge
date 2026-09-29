import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

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
  run?: ReturnType<typeof makeRun>;
  runNotFound?: boolean;
  existingEvents?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
  registerOptions?: Record<string, unknown>;
}

async function buildApp(opts: BuildAppOptions = {}) {
  const run = opts.run ?? makeRun();

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
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const notificationService = {
    isConfigured: () => true,
    sendHumanRequest: vi.fn().mockResolvedValue({
      slack: { attempted: true, ok: true },
      email: { attempted: false, ok: false },
    }),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    undefined,
    { notificationService: notificationService as never, ...opts.registerOptions },
  );
  await app.ready();

  return { app, mockEventRepo, notificationService };
}

describe("POST /api/runs/:id/actions/request-human — default options and extra branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, notificationService } = await buildApp({ runNotFound: true });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing-run/actions/request-human",
      payload: { reason: "other", summary: "Needs eyes" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
    expect(notificationService.sendHumanRequest).not.toHaveBeenCalled();
  });

  it("uses the default 6h debounceHours and default uiBaseUrl when options are omitted", async () => {
    const { app, notificationService } = await buildApp({ registerOptions: {} });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Needs eyes" },
    });

    expect(res.statusCode).toBe(200);
    const payload = notificationService.sendHumanRequest.mock.calls[0][0] as { runUrl: string };
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("treats a whitespace-only context as no context provided", async () => {
    const { app, notificationService } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Needs eyes", context: "   " },
    });

    expect(res.statusCode).toBe(200);
    const payload = notificationService.sendHumanRequest.mock.calls[0][0] as { context?: string };
    expect(payload.context).toBeUndefined();
  });

  it("omits linearIssue.identifier when the run has no linearIssueIdentifier", async () => {
    const run = makeRun({ linearIssueIdentifier: null });
    const { app, notificationService } = await buildApp({ run });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Needs eyes" },
    });

    expect(res.statusCode).toBe(200);
    const payload = notificationService.sendHumanRequest.mock.calls[0][0] as {
      linearIssue: { identifier?: string };
    };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });

  it("does not debounce when the only matching-reason HUMAN_REQUESTED event is older than the debounce window", async () => {
    const staleTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, outside the 6h default window
    const { app, notificationService, mockEventRepo } = await buildApp({
      existingEvents: [
        { eventType: RunEvent.HUMAN_REQUESTED, createdAt: staleTs, payloadJson: { reason: "other" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Needs eyes again" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
    expect(notificationService.sendHumanRequest).toHaveBeenCalledTimes(1);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });

  it("does not debounce when prior events exist but none have eventType HUMAN_REQUESTED", async () => {
    const recentTs = new Date(Date.now() - 60 * 1000);
    const { app, notificationService } = await buildApp({
      existingEvents: [
        { eventType: "SOME_OTHER_EVENT", createdAt: recentTs, payloadJson: { reason: "other" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Needs eyes" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
    expect(notificationService.sendHumanRequest).toHaveBeenCalledTimes(1);
  });
});
