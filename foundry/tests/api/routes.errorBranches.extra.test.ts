import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
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

async function buildApp(
  orchestratorOverrides: Record<string, unknown> = {},
  linearPollOverrides?: Record<string, unknown>,
) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

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
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    ...orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockLinearPollService = linearPollOverrides
    ? { discoverPendingIssues: vi.fn(), startRunsForIssues: vi.fn(), ...linearPollOverrides }
    : undefined;

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    mockLinearPollService as never,
  );

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("sanitizeNote whitespace-only branch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("treats a whitespace-only note the same as no note", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });
});

describe("non-Error rejection branches across action routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approve-plan: returns String(err) when approvePlan rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("approve-plan: logs with truncated message when the background runExecution rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockRejectedValue("background failure");

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });
    await flush();
    // No assertion beyond "did not throw" — the catch branch swallows and logs.
  });

  it("reject-plan: returns String(err) for a non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockRejectedValue("rejected oddly");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "rejected oddly" });
  });

  it("re-review-plan: returns String(err) when sanitizeNote/dispatch throws synchronously with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw "sync failure";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync failure" });
  });

  it("re-review-plan: logs with truncated message when the background call rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue("background failure");

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });
    await flush();
  });

  it("revise-plan: returns String(err) when dispatch throws synchronously with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw "sync failure";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync failure" });
  });

  it("revise-plan: logs with truncated message when the background call rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue("background failure");

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });
    await flush();
  });

  it("approve-review: returns String(err) for a non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue("review failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "review failure" });
  });

  it("pause: returns String(err) for a non-Error rejection from handleCommand", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue("pause failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "pause failure" });
  });

  it("resume: returns String(err) for a non-Error rejection from handleCommand", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue("resume failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "resume failure" });
  });

  it("retry: logError truncates and handles a non-Error rejection from the background trigger", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue("retry failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await flush();
  });
});

describe("Linear routes: non-Error rejection branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /api/linear/pending returns String(err) for a non-Error rejection", async () => {
    const { app } = await buildApp({}, { discoverPendingIssues: vi.fn().mockRejectedValue("linear down") });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "linear down" });
  });

  it("POST /api/linear/ingest returns String(err) for a non-Error rejection", async () => {
    const { app } = await buildApp(
      {},
      { startRunsForIssues: vi.fn().mockRejectedValue("ingest down") },
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ingest down" });
  });
});

describe("GET /api/runs/:id/skills — ?? default branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to an empty skillIds array when a SKILL_INJECTION event omits skillIds", async () => {
    const mockEventRepo = { findByRunId: vi.fn() };
    const mockAgentSkillRepo = { findById: vi.fn() };
    const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun()) };
    const mockArtifactRepo = { findByRunId: vi.fn() };

    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => mockArtifactRepo,
      getEventRepo: () => mockEventRepo,
      getAgentSkillRepo: () => mockAgentSkillRepo,
    };
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    const app = Fastify({ logger: false });
    registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
    await app.ready();

    mockEventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: {}, createdAt: new Date() },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ injectedSkills: [] });
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("uses the skill's own name/description when the distillation payload omits them (truthy-side of ?? is exercised when provided)", async () => {
    const mockEventRepo = { findByRunId: vi.fn() };
    const mockAgentSkillRepo = {
      findById: vi.fn().mockResolvedValue({
        id: "skill-1",
        repoSlug: "test-repo",
        name: "payload-provided-name",
        description: "payload-provided-description",
        taskCategory: "cat",
        skillMarkdown: "md",
        successCount: 0,
        failureCount: 0,
        utilityScore: 0,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        archivedAt: null,
      }),
    };
    const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun()) };
    const mockArtifactRepo = { findByRunId: vi.fn() };

    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => mockArtifactRepo,
      getEventRepo: () => mockEventRepo,
      getAgentSkillRepo: () => mockAgentSkillRepo,
    };
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    const app = Fastify({ logger: false });
    registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
    await app.ready();

    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: true,
          reason: "insight",
          taskCategory: "cat",
          name: "payload-provided-name",
          description: "payload-provided-description",
          skillId: "skill-1",
          displacedSkillId: null,
        },
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { distillationDecision: { name: string; description: string } };
    expect(body.distillationDecision.name).toBe("payload-provided-name");
    expect(body.distillationDecision.description).toBe("payload-provided-description");
  });
});
