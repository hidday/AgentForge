import { describe, it, expect, vi } from "vitest";
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
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

async function buildApp(orchestratorOverrides: Record<string, unknown> = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn(), create: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: () => undefined,
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    ...orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();
  return { app, mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo, mockEmitter };
}

describe("GET /api/runs", () => {
  it("lists all runs and forwards the state querystring filter", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([makeRun()]);

    const response = await app.inject({ method: "GET", url: "/api/runs?state=Planning,PlanReview" });

    expect(response.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Planning,PlanReview");
    const body = JSON.parse(response.body) as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
  });

  it("returns an empty list when there are no runs", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const response = await app.inject({ method: "GET", url: "/api/runs" });

    expect(JSON.parse(response.body)).toEqual({ runs: [] });
  });
});

describe("GET /api/runs/:id", () => {
  it("returns the run with its artifacts and events", async () => {
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a-1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e-1" }]);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "a-1" }]);
    expect(body.events).toEqual([{ id: "e-1" }]);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: "Run not found" });
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns the run's artifacts", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a-1" }, { id: "a-2" }]);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ artifacts: [{ id: "a-1" }, { id: "a-2" }] });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns the run's events", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e-1" }]);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ events: [{ id: "e-1" }] });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, fires execution in the background, and returns the new state", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockResolvedValue(makeRun());

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "looks good" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(JSON.parse(response.body)).toEqual({ ok: true, state: RunState.Implementing });
  });

  it("does not fail the request when the background execution kickoff rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns 400 when approvePlan rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Run is not awaiting approval"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Run is not awaiting approval" });
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("kicks off a manual re-review in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(makeRun());

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: "please re-check" });
    expect(JSON.parse(response.body)).toEqual({ ok: true, runId: "run-1" });
  });

  it("does not fail the request when the background re-review kickoff rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("kicks off a manual plan revision in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(makeRun());

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "address feedback" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "address feedback",
    });
    expect(JSON.parse(response.body)).toEqual({ ok: true, runId: "run-1" });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("approves the human review and returns the new state", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(makeRun({ state: RunState.Done }));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
    expect(JSON.parse(response.body)).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when approveHumanReview rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("not awaiting review"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  it("sends a pause-ai command for the run's Linear issue", async () => {
    const { app, mockOrchestrator, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when handleCommand rejects", async () => {
    const { app, mockOrchestrator, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "cannot pause" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  it("sends a resume-ai command for the run's Linear issue", async () => {
    const { app, mockOrchestrator, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when handleCommand rejects", async () => {
    const { app, mockOrchestrator, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ] as const)("triggers %s via orchestrator.%s and returns 200 immediately", async (state, method) => {
    const { app, mockOrchestrator, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state }));
    (mockOrchestrator[method] as ReturnType<typeof vi.fn>).mockResolvedValue(makeRun({ state }));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator[method]).toHaveBeenCalledWith("run-1");
    const body = JSON.parse(response.body) as { ok: boolean; retrying: boolean; state: string };
    expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
  });

  it("does not fail the request when the triggered retry rejects in the background", async () => {
    const { app, mockOrchestrator, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue(new Error("boom"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(200);
  });

  it("returns 400 for a state with no retry handler", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain(`Retry is not supported for state "${RunState.Done}"`);
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(response.statusCode).toBe(404);
  });

  it("returns null plan/review/executionReport sections when no artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
  });

  it("flattens string risks, object risks with a description, and un-stringifiable risks", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const circular: Record<string, unknown> = { note: "circular" };
    circular.self = circular;

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 2,
          payloadJson: {
            summary: "Do the thing",
            confidence: 0.8,
            openQuestions: [],
            steps: [{ id: "s1", title: "Step 1", description: "desc" }],
            risks: ["plain string risk", { description: "object risk" }, circular],
            testPlan: "run tests",
          },
        });
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { plan: { risks: string[]; riskCount: number } };
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toBe(String(circular));
    expect(body.plan.riskCount).toBe(3);
  });

  it("derives executionVersion from the payload, falling back to the artifact version", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({ version: 5, payloadJson: { score: 0.9, scoreRationale: "good" } });
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = JSON.parse(response.body) as {
      executionReport: { executionVersion: number; score: number; scoreRationale: string };
    };
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBe(0.9);
    expect(body.executionReport.scoreRationale).toBe("good");
  });
});

describe("POST /api/runs/:id/chat", () => {
  it("returns 501 when claudeCodeRunner is not configured", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(response.statusCode).toBe(501);
  });

  it("returns 400 when message is missing or blank", async () => {
    const app2 = Fastify({ logger: false });
    const mockOrchestrator = {
      getRunRepo: () => ({ findById: vi.fn() }),
      getArtifactRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
      getEventRepo: () => ({ findByRunId: vi.fn() }),
      getAgentSkillRepo: () => undefined,
    };
    const mockClaudeCodeRunner = { chatRun: vi.fn() };
    registerApiRoutes(
      app2,
      mockOrchestrator as never,
      { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() } as never,
      { getActiveProcesses: vi.fn().mockReturnValue([]), getProcessOutput: vi.fn() } as never,
      undefined,
      { claudeCodeRunner: mockClaudeCodeRunner as never },
    );
    await app2.ready();

    const response = await app2.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "   " },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 404 when the run does not exist", async () => {
    const app2 = Fastify({ logger: false });
    const mockRunRepo = { findById: vi.fn().mockResolvedValue(null) };
    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
      getEventRepo: () => ({ findByRunId: vi.fn() }),
      getAgentSkillRepo: () => undefined,
    };
    registerApiRoutes(
      app2,
      mockOrchestrator as never,
      { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() } as never,
      { getActiveProcesses: vi.fn().mockReturnValue([]), getProcessOutput: vi.fn() } as never,
      undefined,
      { claudeCodeRunner: { chatRun: vi.fn() } as never },
    );
    await app2.ready();

    const response = await app2.inject({
      method: "POST",
      url: "/api/runs/missing/chat",
      payload: { message: "hi" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("persists user+assistant ChatMessage artifacts and emits a chat-reply event on success", async () => {
    const app2 = Fastify({ logger: false });
    const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun({ workingDirectory: "/tmp" })) };
    const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() };
    const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
    const mockClaudeCodeRunner = {
      chatRun: vi.fn().mockResolvedValue({ text: "the answer", durationMs: 42 }),
    };
    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => mockArtifactRepo,
      getEventRepo: () => ({ findByRunId: vi.fn() }),
      getAgentSkillRepo: () => undefined,
    };
    registerApiRoutes(
      app2,
      mockOrchestrator as never,
      mockEmitter as never,
      { getActiveProcesses: vi.fn().mockReturnValue([]), getProcessOutput: vi.fn() } as never,
      undefined,
      { claudeCodeRunner: mockClaudeCodeRunner as never },
    );
    await app2.ready();

    const response = await app2.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "what's next?" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ reply: "the answer", durationMs: 42 });
    expect(mockArtifactRepo.create).toHaveBeenCalledTimes(2);
    expect(mockArtifactRepo.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "ChatMessage", payloadJson: { role: "user", content: "what's next?" } }));
    expect(mockArtifactRepo.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "ChatMessage", payloadJson: { role: "assistant", content: "the answer" } }));
    expect(mockEmitter.emitChatReply).toHaveBeenCalledWith("run-1", "the answer", 42);
  });

  it("returns 500 when the chat runner throws", async () => {
    const app2 = Fastify({ logger: false });
    const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun({ workingDirectory: "/tmp" })) };
    const mockClaudeCodeRunner = { chatRun: vi.fn().mockRejectedValue(new Error("runner crashed")) };
    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
      getEventRepo: () => ({ findByRunId: vi.fn() }),
      getAgentSkillRepo: () => undefined,
    };
    registerApiRoutes(
      app2,
      mockOrchestrator as never,
      { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() } as never,
      { getActiveProcesses: vi.fn().mockReturnValue([]), getProcessOutput: vi.fn() } as never,
      undefined,
      { claudeCodeRunner: mockClaudeCodeRunner as never },
    );
    await app2.ready();

    const response = await app2.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(response.statusCode).toBe(500);
  });

  it("returns 422 when the run's working directory no longer exists and no repo fallback is found", async () => {
    const app2 = Fastify({ logger: false });
    const mockRunRepo = {
      findById: vi.fn().mockResolvedValue(makeRun({ workingDirectory: "/definitely/does/not/exist" })),
    };
    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => ({ findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() }),
      getEventRepo: () => ({ findByRunId: vi.fn() }),
      getAgentSkillRepo: () => undefined,
    };
    registerApiRoutes(
      app2,
      mockOrchestrator as never,
      { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() } as never,
      { getActiveProcesses: vi.fn().mockReturnValue([]), getProcessOutput: vi.fn() } as never,
      undefined,
      { claudeCodeRunner: { chatRun: vi.fn() } as never },
    );
    await app2.ready();

    const response = await app2.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(response.statusCode).toBe(422);
  });
});
