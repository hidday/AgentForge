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
  existingEvents?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
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
    { notificationService: notificationService as never },
  );
  await app.ready();

  return { app, mockEventRepo, sendHumanRequest };
}

describe("POST /api/runs/:id/actions/request-human — additional branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("does not debounce on a prior event of a different eventType", async () => {
    const recentTs = new Date(Date.now() - 60 * 60 * 1000);
    const { app, sendHumanRequest } = await buildApp({
      existingEvents: [
        { eventType: "PLAN_CREATED", createdAt: recentTs, payloadJson: { reason: "other" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("does not debounce when the matching-reason event is older than the debounce window", async () => {
    const oldTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, beyond default 6h window
    const { app, sendHumanRequest } = await buildApp({
      existingEvents: [
        { eventType: RunEvent.HUMAN_REQUESTED, createdAt: oldTs, payloadJson: { reason: "other" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("trims context and omits it (undefined) when context is empty/whitespace", async () => {
    const { app, mockEventRepo } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hi", context: "   " },
    });

    expect(res.statusCode).toBe(200);
    const eventArgs = mockEventRepo.create.mock.calls[0][0] as { payloadJson: { context: unknown } };
    expect(eventArgs.payloadJson.context).toBeNull();
  });

  it("omits linearIssue.identifier (undefined) when the run has no linearIssueIdentifier", async () => {
    const { app, sendHumanRequest } = await buildApp({ run: makeRun({ linearIssueIdentifier: null }) });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { linearIssue: { identifier?: string } };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });
});
