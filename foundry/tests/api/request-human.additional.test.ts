import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

/**
 * Additional coverage for POST /api/runs/:id/actions/request-human that the
 * existing request-human.route.test.ts does not exercise: the "run not
 * found" 404 branch, the default (unconfigured) debounceHours/uiBaseUrl
 * fallbacks, the debounce cutoff-window boundary, and a null linearIssueIdentifier.
 */
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

interface BuildOpts {
  findByIdResult?: ReturnType<typeof makeRun> | null;
  existingEvents?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
  registerOptions?: Record<string, unknown>;
}

async function buildApp(opts: BuildOpts = {}) {
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(
      opts.findByIdResult === undefined ? makeRun() : opts.findByIdResult,
    ),
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
    { notificationService: notificationService as never, ...opts.registerOptions },
  );
  await app.ready();

  return { app, mockRunRepo, mockEventRepo, sendHumanRequest };
}

describe("POST /api/runs/:id/actions/request-human (additional coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ findByIdResult: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hello" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Run not found");
  });

  it("uses the default debounceHours (6) and default uiBaseUrl when not configured", async () => {
    const { app, sendHumanRequest } = await buildApp({ registerOptions: {} });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Using defaults" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { runUrl: string };
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("does not debounce when the prior matching event is older than the debounce window", async () => {
    const staleTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, default window is 6h
    const { app, sendHumanRequest, mockEventRepo } = await buildApp({
      existingEvents: [
        { eventType: RunEvent.HUMAN_REQUESTED, createdAt: staleTs, payloadJson: { reason: "other" } },
      ],
      registerOptions: {},
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Stale prior event" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });

  it("omits linearIssue.identifier when the run has no linearIssueIdentifier", async () => {
    const { app, sendHumanRequest } = await buildApp({
      findByIdResult: makeRun({ linearIssueIdentifier: null }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "No identifier" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as {
      linearIssue: { identifier?: string };
    };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });
});
