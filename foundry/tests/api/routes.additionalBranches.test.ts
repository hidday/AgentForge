import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Test description",
    linearIssueTitle: "Test issue",
    linearIssueUrl: "https://linear.app/x/issue/ENG-1",
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

async function buildApp(routeOptions: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const mockRunRepo = {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(makeRun()),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
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
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    getLinearClient: vi.fn(),
    ...overrides,
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
    routeOptions,
  );
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("re-review-plan / revise-plan background (async) non-Error rejection branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-review-plan: logs a stringified non-Error when the background call rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue("async non-error failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await flush();
  });

  it("revise-plan: logs a stringified non-Error when the background call rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue("async non-error failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await flush();
  });
});

describe("GET /api/runs/:id/skills -- remaining fallback branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a SKILL_INJECTION event with no skillIds field as contributing no ids", async () => {
    const agentSkillRepo = { findById: vi.fn(), findByRepoCategoryNearTime: vi.fn() };
    const { app, mockEventRepo } = await buildApp(
      {},
      { getAgentSkillRepo: vi.fn().mockReturnValue(agentSkillRepo) },
    );
    mockEventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: {}, createdAt: new Date() },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
    expect(agentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("defaults shouldPersist to false and reason to '' when the distillation payload omits them", async () => {
    const { app, mockEventRepo } = await buildApp();
    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      distillationDecision: { shouldPersist: boolean; reason: string } | null;
    };
    expect(body.distillationDecision).toMatchObject({ shouldPersist: false, reason: "" });
  });
});

describe("POST /api/runs/:id/actions/request-human -- remaining branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp({
      notificationService: { isConfigured: () => false, sendHumanRequest: vi.fn() },
    });
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "test" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("defaults debounceHours to 6 and uiBaseUrl to http://localhost:5173 when not configured", async () => {
    const sendHumanRequest = vi.fn().mockResolvedValue({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    const { app } = await buildApp({
      notificationService: { isConfigured: () => true, sendHumanRequest },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "test summary" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { runUrl: string };
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("does not debounce when a HUMAN_REQUESTED event with a matching reason is outside the debounce window", async () => {
    const staleTs = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100h ago, well past any debounce window
    const sendHumanRequest = vi.fn().mockResolvedValue({
      slack: { attempted: true, ok: true },
      email: { attempted: false, ok: false },
    });
    const { app, mockEventRepo } = await buildApp({
      notificationService: { isConfigured: () => true, sendHumanRequest },
      debounceHours: 6,
    });
    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.HUMAN_REQUESTED,
        source: "api",
        payloadJson: { reason: "other" },
        createdAt: staleTs,
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "still an issue" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { debounced: boolean }).debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("ignores non-HUMAN_REQUESTED events entirely when checking for a debounce match", async () => {
    const sendHumanRequest = vi.fn().mockResolvedValue({
      slack: { attempted: true, ok: true },
      email: { attempted: false, ok: false },
    });
    const { app, mockEventRepo } = await buildApp({
      notificationService: { isConfigured: () => true, sendHumanRequest },
      debounceHours: 6,
    });
    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SOME_OTHER_EVENT",
        source: "api",
        payloadJson: { reason: "other" },
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "brand new issue" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { debounced: boolean }).debounced).toBe(false);
  });

  it("passes undefined for linearIssue.identifier when the run's identifier is null", async () => {
    const sendHumanRequest = vi.fn().mockResolvedValue({
      slack: { attempted: true, ok: true },
      email: { attempted: false, ok: false },
    });
    const { app, mockRunRepo } = await buildApp({
      notificationService: { isConfigured: () => true, sendHumanRequest },
      debounceHours: 6,
    });
    mockRunRepo.findById.mockResolvedValue(makeRun({ linearIssueIdentifier: null }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "no identifier on this run" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { linearIssue: { identifier?: string } };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });
});
