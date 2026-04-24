import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

function makeRun(state = RunState.AwaitingPlanApproval) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "Test issue body for request-human route tests.",
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state,
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
  };
}

interface BuildAppOptions {
  existingEvents?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
  planPayload?: unknown;
  isConfigured?: boolean;
  sendHumanRequestImpl?: () => Promise<{
    slack: { attempted: boolean; ok: boolean; error?: string };
    email: { attempted: boolean; ok: boolean; error?: string };
  }>;
}

async function buildApp(opts: BuildAppOptions = {}) {
  const run = makeRun();

  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(run),
    findAll: vi.fn(),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(
      opts.planPayload !== undefined
        ? { id: "art-1", runId: run.id, type: "Plan", version: 1, payloadJson: opts.planPayload, rawText: "", createdAt: new Date() }
        : null,
    ),
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

  const sendHumanRequest = vi.fn(
    opts.sendHumanRequestImpl ??
      (async () => ({
        slack: { attempted: true, ok: true },
        email: { attempted: false, ok: false },
      })),
  );

  const notificationService = {
    isConfigured: () => opts.isConfigured ?? true,
    sendHumanRequest,
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    undefined,
    {
      notificationService: notificationService as never,
      uiBaseUrl: "http://localhost:5173",
      debounceHours: 6,
    },
  );
  await app.ready();

  return { app, mockEventRepo, sendHumanRequest };
}

describe("POST /api/runs/:id/actions/request-human", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when reason is missing or invalid", async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "bogus", summary: "hi" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("reason must be one of");
  });

  it("returns 400 when summary is missing", async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("summary");
  });

  it("sends notification, records event, returns ok with notified=true for slack", async () => {
    const { app, mockEventRepo, sendHumanRequest } = await buildApp({
      planPayload: { confidence: 0.7, openQuestions: [] },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: {
        reason: "plan_ambiguous",
        summary: "Plan confidence below threshold and requirements unclear",
        context: "Linear issue mentions OAuth but plan proposes API keys",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.debounced).toBe(false);
    expect(body.notified.slack).toBe(true);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
    const payload = sendHumanRequest.mock.calls[0][0] as {
      reason: string;
      runUrl: string;
      planConfidence: number;
      linearIssue: { identifier?: string; id: string };
    };
    expect(payload.reason).toBe("plan_ambiguous");
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
    expect(payload.planConfidence).toBe(0.7);
    expect(payload.linearIssue.identifier).toBe("LIN-1");
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
    const eventArgs = mockEventRepo.create.mock.calls[0][0];
    expect(eventArgs.eventType).toBe(RunEvent.HUMAN_REQUESTED);
    expect(eventArgs.source).toBe("api");
  });

  it("debounces when a matching HUMAN_REQUESTED event is within the window", async () => {
    const recentTs = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const { app, mockEventRepo, sendHumanRequest } = await buildApp({
      existingEvents: [
        {
          eventType: RunEvent.HUMAN_REQUESTED,
          createdAt: recentTs,
          payloadJson: { reason: "plan_ambiguous" },
        },
      ],
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Same issue again" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.debounced).toBe(true);
    expect(sendHumanRequest).not.toHaveBeenCalled();
    expect(mockEventRepo.create).not.toHaveBeenCalled();
  });

  it("does not debounce when prior event had a different reason", async () => {
    const recentTs = new Date(Date.now() - 60 * 60 * 1000);
    const { app, sendHumanRequest } = await buildApp({
      existingEvents: [
        {
          eventType: RunEvent.HUMAN_REQUESTED,
          createdAt: recentTs,
          payloadJson: { reason: "impl_rejected" },
        },
      ],
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Different reason" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("records event even when no channels configured (notified all false)", async () => {
    const { app, mockEventRepo, sendHumanRequest } = await buildApp({
      isConfigured: false,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Manual flag" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.notified).toEqual({ slack: false, email: false });
    expect(sendHumanRequest).not.toHaveBeenCalled();
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });
});
