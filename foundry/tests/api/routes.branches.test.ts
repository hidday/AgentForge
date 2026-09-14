import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// This file targets specific error-handling and default-value branches in
// routes.ts that the "happy path" test files (routes.chat, routes.misc,
// answer-questions, reject-plan, request-human, runsSkills) don't exercise:
// non-Error rejections, generic-Error fallbacks after typed-error checks,
// and options defaulting (debounceHours/uiBaseUrl) when callers omit them.

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
    linearIssueUrl: "https://linear.app/x/issue/ENG-42",
    repo: "test/repo",
    branchName: "main",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/not-checked",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function buildApp(routeOptions: Record<string, unknown> = {}, linearPollService?: unknown) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(undefined),
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
    runPlanning: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    retryRun: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
    getLinearClient: vi.fn(),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app: FastifyInstance = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    linearPollService as never,
    routeOptions,
  );

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("chat route: working-directory fallback branch", () => {
  it("falls back to the main repo directory when the worktree path is gone, and succeeds", async () => {
    const repoDir = mkdtempSync(join(tmpdir(), "routes-branches-repo-"));
    try {
      const chatRunner = { chatRun: vi.fn().mockResolvedValue({ text: "ok", durationMs: 1 }) };
      const { app, mockRunRepo, mockArtifactRepo } = buildApp({ claudeCodeRunner: chatRunner });
      await app.ready();
      const missingWorktree = join(repoDir, ".worktrees", "run-does-not-exist");
      mockRunRepo.findById.mockResolvedValue(makeRun({ workingDirectory: missingWorktree }));
      mockArtifactRepo.create.mockImplementation((p: Record<string, unknown>) => ({
        id: "a1",
        ...p,
      }));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "hi" },
      });

      expect(res.statusCode).toBe(200);
      expect(chatRunner.chatRun).toHaveBeenCalledOnce();
      const [input] = chatRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
      expect(input.workingDirectory).toBe(repoDir);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("returns 422 when neither the worktree nor the fallback repo directory exists", async () => {
    const chatRunner = { chatRun: vi.fn() };
    const { app, mockRunRepo } = buildApp({ claudeCodeRunner: chatRunner });
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(
      makeRun({ workingDirectory: "/definitely/not/a/real/path/.worktrees/run-x" }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
    expect(chatRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 422 when the working directory is missing and has no .worktrees/ segment at all", async () => {
    const chatRunner = { chatRun: vi.fn() };
    const { app, mockRunRepo } = buildApp({ claudeCodeRunner: chatRunner });
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun({ workingDirectory: "/no/such/dir" }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
  });

  it("returns 500 with a stringified message when chatRun rejects with a non-Error value", async () => {
    const chatRunner = { chatRun: vi.fn().mockRejectedValue("plain string failure") };
    const { app, mockRunRepo } = buildApp({ claudeCodeRunner: chatRunner });
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun({ workingDirectory: "/tmp" }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Chat request failed" });
  });
});

describe("skills route: default-value branches", () => {
  it("defaults skillIds to [] when a SKILL_INJECTION event payload omits it", async () => {
    const agentSkillRepo = { findById: vi.fn(), findByRepoCategoryNearTime: vi.fn() };
    const { app, mockRunRepo, mockEventRepo, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.getAgentSkillRepo.mockReturnValue(agentSkillRepo);
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([
      { id: "e1", eventType: "SKILL_INJECTION", payloadJson: {}, createdAt: new Date() },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json().injectedSkills).toEqual([]);
    expect(agentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("defaults shouldPersist to false and reason to '' when a SKILL_DISTILLATION payload omits them", async () => {
    const { app, mockRunRepo, mockEventRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([
      { id: "e1", eventType: "SKILL_DISTILLATION", payloadJson: {}, createdAt: new Date() },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json().distillationDecision).toEqual({
      shouldPersist: false,
      reason: "",
      taskCategory: null,
      name: null,
      description: null,
      displacedSkillId: null,
    });
  });
});

describe("approve-plan route: non-Error branches", () => {
  it("returns 400 with a stringified message when approvePlan rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.approvePlan.mockRejectedValue("plain rejection");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain rejection" });
  });

  it("logs a stringified message when the background runExecution rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    const errorSpy = vi.spyOn(app.log, "error").mockImplementation(() => {});
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun());
    mockOrchestrator.runExecution.mockRejectedValue("execution string failure");

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "execution string failure" }),
        "Execution failed",
      );
    });
  });
});

describe("reject-plan route: invalid mode and non-Error branches", () => {
  it("returns 400 when mode is not 'iterate' or 'fresh'", async () => {
    const { app } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus-mode" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
  });

  it("accepts mode: 'fresh' and passes it through to rejectPlan", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.rejectPlan.mockResolvedValue(makeRun({ state: RunState.Todo }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "fresh");
  });

  it("returns 400 with a stringified message when rejectPlan rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.rejectPlan.mockRejectedValue(42);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "42" });
  });
});

describe("re-review-plan / revise-plan routes: synchronous-throw branches", () => {
  it("re-review-plan returns 400 when orchestrator.runManualReReview throws synchronously", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("sync re-review boom");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync re-review boom" });
  });

  it("revise-plan returns 400 when orchestrator.runManualPlanRevision throws synchronously", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("sync revise boom");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync revise boom" });
  });
});

describe("approve-review / pause / resume: non-Error branches", () => {
  it("approve-review returns 400 with a stringified message on a non-Error rejection", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.approveHumanReview.mockRejectedValue({ weird: "object" });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "[object Object]" });
  });

  it("pause returns 400 with a stringified message on a non-Error rejection", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue("pause string failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "pause string failure" });
  });

  it("resume returns 400 with a stringified message on a non-Error rejection", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue("resume string failure");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "resume string failure" });
  });
});

describe("answer-questions route: generic Error fallback branch", () => {
  it("returns 400 for a plain Error that is neither PolicyError nor ValidationError", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.answerQuestions.mockRejectedValue(new Error("totally unexpected failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "a1" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "totally unexpected failure" });
  });
});

describe("retry route: non-Error branch in background logError", () => {
  it("logs a stringified message when the retry trigger rejects with a non-Error", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    await app.ready();
    const errorSpy = vi.spyOn(app.log, "error").mockImplementation(() => {});
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue("retry string failure");

    await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "retry string failure" }),
        "Retry stage failed",
      );
    });
  });
});

describe("summary route: additional branches", () => {
  it("defaults steps to [] and stepCount to 0 when plan.steps is not an array", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return { version: 1, payloadJson: { summary: "no steps here" } };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json();

    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.risks).toEqual([]);
  });

  it("falls back to String(r) when a risk object can't be JSON.stringify'd (circular reference)", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return { version: 1, payloadJson: { risks: [circular] } };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json();

    expect(body.plan.risks).toEqual(["[object Object]"]);
  });
});

describe("request-human route: option defaults, missing run, and event-filter branches", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = buildApp({
      notificationService: { isConfigured: () => false, sendHumanRequest: vi.fn() },
    });
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hello" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("uses the default debounceHours (6) and default uiBaseUrl when routeOptions omit them", async () => {
    const { app, mockRunRepo, mockEventRepo } = buildApp({
      notificationService: { isConfigured: () => false, sendHumanRequest: vi.fn() },
      // debounceHours and uiBaseUrl intentionally omitted
    });
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hello there" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockEventRepo.create).toHaveBeenCalledOnce();
    const eventArgs = mockEventRepo.create.mock.calls[0]![0] as {
      payloadJson: { runUrl: string };
    };
    // Default uiBaseUrl is http://localhost:5173
    expect(eventArgs.payloadJson.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("does not debounce on a prior event of a different eventType, even with a matching reason shape", async () => {
    const { app, mockRunRepo, mockEventRepo } = buildApp({
      notificationService: { isConfigured: () => false, sendHumanRequest: vi.fn() },
    });
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e0",
        eventType: RunEvent.PLAN_CREATED,
        payloadJson: { reason: "other" },
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hello there" },
    });

    expect(res.json().debounced).toBe(false);
  });

  it("does not debounce on a matching-reason HUMAN_REQUESTED event older than the debounce window", async () => {
    const { app, mockRunRepo, mockEventRepo } = buildApp({
      notificationService: { isConfigured: () => false, sendHumanRequest: vi.fn() },
      debounceHours: 1,
    });
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e0",
        eventType: RunEvent.HUMAN_REQUESTED,
        payloadJson: { reason: "other" },
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago, window is 1h
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hello there" },
    });

    expect(res.json().debounced).toBe(false);
  });

  it("falls back linearIssueIdentifier to undefined when the run has none", async () => {
    const { app, mockRunRepo } = buildApp({
      notificationService: { isConfigured: () => false, sendHumanRequest: vi.fn() },
    });
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun({ linearIssueIdentifier: null }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hello there" },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("Linear polling routes: non-Error rejection branches", () => {
  it("GET /api/linear/pending returns 500 with a stringified message on a non-Error rejection", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue("pending string failure"),
      startRunsForIssues: vi.fn(),
    };
    const { app } = buildApp({}, linearPollService);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "pending string failure" });
  });

  it("POST /api/linear/ingest returns 500 with a stringified message on a non-Error rejection", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockRejectedValue("ingest string failure"),
    };
    const { app } = buildApp({}, linearPollService);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ingest string failure" });
  });
});
