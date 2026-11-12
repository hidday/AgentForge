import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Covers branches of POST /api/runs/:id/actions/request-human that
// tests/api/request-human.route.test.ts does not exercise: the 404 path,
// the default debounceHours/uiBaseUrl values (when RegisterApiRoutesOptions
// omits them), a differently-typed prior event in the debounce lookup, and
// a run whose linearIssueIdentifier is null.

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
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

async function buildApp(opts: {
  run?: ReturnType<typeof makeRun> | null;
  events?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
  registerOptions?: Record<string, unknown>;
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
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    undefined,
    opts.registerOptions ?? {},
  );
  await app.ready();

  return { app, mockRunRepo, mockEventRepo };
}

describe("POST /api/runs/:id/actions/request-human — additional branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "Need a human" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("uses the default 6h debounce window and default UI base URL when no options are configured", async () => {
    const recentTs = new Date(Date.now() - 60 * 60 * 1000); // 1h ago, within default 6h window
    const { app, mockEventRepo } = await buildApp({
      events: [
        {
          eventType: RunEvent.HUMAN_REQUESTED,
          createdAt: recentTs,
          payloadJson: { reason: "other" },
        },
      ],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Default options path" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).debounced).toBe(true);
    expect(mockEventRepo.create).not.toHaveBeenCalled();
  });

  it("records runUrl using the default UI base URL when not debounced and no options are configured", async () => {
    const { app, mockEventRepo } = await buildApp({});

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "No channels, default base url" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
    const eventArgs = mockEventRepo.create.mock.calls[0][0] as { payloadJson: { runUrl: string } };
    expect(eventArgs.payloadJson.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("ignores prior events of a different eventType when checking for a debounce match", async () => {
    const recentTs = new Date(Date.now() - 60 * 60 * 1000);
    const { app, mockEventRepo } = await buildApp({
      events: [
        {
          eventType: "SKILL_INJECTION",
          createdAt: recentTs,
          payloadJson: { reason: "other" },
        },
      ],
      registerOptions: { debounceHours: 6, uiBaseUrl: "http://localhost:5173" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Not a HUMAN_REQUESTED event" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).debounced).toBe(false);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });

  it("falls back to undefined linearIssue.identifier when the run has none", async () => {
    const sendHumanRequest = vi.fn().mockResolvedValue({
      slack: { attempted: true, ok: true },
      email: { attempted: false, ok: false },
    });
    const { app, mockEventRepo } = await buildApp({
      run: makeRun({ linearIssueIdentifier: null }),
      registerOptions: {
        debounceHours: 6,
        uiBaseUrl: "http://localhost:5173",
        notificationService: { isConfigured: () => true, sendHumanRequest },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "No linear identifier" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
    const payload = sendHumanRequest.mock.calls[0][0] as {
      linearIssue: { identifier?: string };
    };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });
});
