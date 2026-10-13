import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter, type DashboardEvent } from "../../src/api/runEventEmitter.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
    repo: "test/repo",
    branchName: "feature/x",
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

interface BuildAppOptions {
  orchestratorOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown>;
  claudeCodeRunner?: Record<string, unknown>;
  notificationService?: Record<string, unknown>;
  uiBaseUrl?: string;
  debounceHours?: number;
}

async function buildApp(opts: BuildAppOptions = {}) {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
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
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    ...opts.orchestratorOverrides,
  };

  const mockEmitter = {
    on: vi.fn(),
    off: vi.fn(),
    emitChatReply: vi.fn(),
  };

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
    opts.linearPollService as never,
    {
      claudeCodeRunner: opts.claudeCodeRunner as never,
      notificationService: opts.notificationService as never,
      uiBaseUrl: opts.uiBaseUrl,
      debounceHours: opts.debounceHours,
    },
  );

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo, mockProcessRunner };
}

describe("routes.additional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/runs", () => {
    it("returns the full list when no state query param is given", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findAll.mockResolvedValue([makeRun()]);

      const res = await app.inject({ method: "GET", url: "/api/runs" });

      expect(res.statusCode).toBe(200);
      expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
      expect(res.json().runs).toHaveLength(1);
    });

    it("passes the state query param through to findAll", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findAll.mockResolvedValue([]);

      const res = await app.inject({ method: "GET", url: "/api/runs?state=Done" });

      expect(res.statusCode).toBe(200);
      expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
    });
  });

  describe("GET /api/runs/:id", () => {
    it("returns 404 when the run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Run not found");
    });

    it("returns run + artifacts + events when found", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.run.id).toBe("run-1");
      expect(body.artifacts).toEqual([{ id: "art-1" }]);
      expect(body.events).toEqual([{ id: "evt-1" }]);
    });
  });

  describe("POST /api/runs/:id/chat (working directory fallback)", () => {
    it("returns 422 when workingDirectory does not exist and has no /.worktrees/ segment", async () => {
      const run = makeRun({ workingDirectory: "/definitely/does/not/exist/anywhere" });
      const claudeCodeRunner = { chatRun: vi.fn() };
      const { app, mockRunRepo } = await buildApp({ claudeCodeRunner });
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "hello" },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toContain("Working directory not found");
      expect(claudeCodeRunner.chatRun).not.toHaveBeenCalled();
    });

    it("falls back to the main repo dir when workingDirectory is a missing .worktrees path", async () => {
      const repoDir = mkdtempSync(join(tmpdir(), "routes-additional-chat-"));
      const run = makeRun({
        workingDirectory: join(repoDir, ".worktrees", "missing-worktree"),
      });
      const claudeCodeRunner = {
        chatRun: vi.fn().mockResolvedValue({ text: "fallback reply", durationMs: 12 }),
      };
      const { app, mockRunRepo } = await buildApp({ claudeCodeRunner });
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "hello" },
      });

      expect(res.statusCode).toBe(200);
      expect(claudeCodeRunner.chatRun).toHaveBeenCalledOnce();
      const [input] = claudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
      expect(input.workingDirectory).toBe(repoDir);
    });

    it("returns 422 when the .worktrees fallback base directory also does not exist", async () => {
      const run = makeRun({
        workingDirectory: "/definitely/does/not/exist/.worktrees/missing-worktree",
      });
      const claudeCodeRunner = { chatRun: vi.fn() };
      const { app, mockRunRepo } = await buildApp({ claudeCodeRunner });
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "hello" },
      });

      expect(res.statusCode).toBe(422);
      expect(claudeCodeRunner.chatRun).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/runs/:id/artifacts", () => {
    it("returns 404 when the run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

      expect(res.statusCode).toBe(404);
    });

    it("returns artifacts for an existing run", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

      expect(res.statusCode).toBe(200);
      expect(res.json().artifacts).toEqual([{ id: "art-1" }]);
    });
  });

  describe("GET /api/runs/:id/events", () => {
    it("returns 404 when the run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

      expect(res.statusCode).toBe(404);
    });

    it("returns events for an existing run", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toEqual([{ id: "evt-1" }]);
    });
  });

  describe("GET /api/runs/:id/skills (default-value branches)", () => {
    it("defaults a SKILL_INJECTION event's missing skillIds to an empty array", async () => {
      const mockAgentSkillRepo = {
        findById: vi.fn().mockResolvedValue(null),
        findByRepoCategoryNearTime: vi.fn().mockResolvedValue(null),
      };
      const { app, mockRunRepo, mockEventRepo } = await buildApp({
        orchestratorOverrides: { getAgentSkillRepo: vi.fn().mockReturnValue(mockAgentSkillRepo) },
      });
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockEventRepo.findByRunId.mockResolvedValue([
        {
          id: "evt-1",
          eventType: "SKILL_INJECTION",
          payloadJson: {},
          createdAt: new Date(),
        },
      ]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

      expect(res.statusCode).toBe(200);
      expect(res.json().injectedSkills).toEqual([]);
      expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
    });

    it("defaults a SKILL_DISTILLATION event's missing shouldPersist/reason", async () => {
      const { app, mockRunRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockEventRepo.findByRunId.mockResolvedValue([
        {
          id: "evt-1",
          eventType: "SKILL_DISTILLATION",
          payloadJson: {},
          createdAt: new Date(),
        },
      ]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.distillationDecision).toMatchObject({ shouldPersist: false, reason: "" });
    });
  });

  describe("POST /api/runs/:id/actions/approve-plan", () => {
    it("returns 200, trims note, and fires runExecution in the background", async () => {
      const run = makeRun({ state: RunState.Implementing });
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approvePlan.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: { note: "  looks good  " },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
      expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
      expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
    });

    it("treats a blank note as undefined", async () => {
      const run = makeRun();
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approvePlan.mockResolvedValue(run);

      await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: { note: "   " },
      });

      expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
    });

    it("returns 400 when approvePlan throws", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approvePlan.mockRejectedValue(new Error("Cannot approve in this state"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Cannot approve in this state");
    });

    it("logs but does not reject the request when the background runExecution fails", async () => {
      const run = makeRun();
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approvePlan.mockResolvedValue(run);
      mockOrchestrator.runExecution.mockRejectedValue(new Error("background failure"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      // allow the fire-and-forget rejection handler (the .catch callback) to run
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  describe("POST /api/runs/:id/actions/reject-plan (mode validation)", () => {
    it("returns 400 when mode is not 'iterate' or 'fresh'", async () => {
      const { app, mockOrchestrator } = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/reject-plan",
        payload: { mode: "bogus-mode" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("mode must be one of: iterate, fresh");
      expect(mockOrchestrator.rejectPlan).not.toHaveBeenCalled();
    });

    it("accepts mode='fresh' and forwards it to rejectPlan", async () => {
      const run = makeRun();
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.rejectPlan.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/reject-plan",
        payload: { mode: "fresh" },
      });

      expect(res.statusCode).toBe(200);
      expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "fresh");
    });
  });

  describe("POST /api/runs/:id/actions/re-review-plan", () => {
    it("returns 200 and fires runManualReReview in the background", async () => {
      const { app, mockOrchestrator } = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
        payload: { note: "please re-check" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1" });
      expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
        note: "please re-check",
      });
    });

    it("logs but does not reject the request when the background call fails", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualReReview.mockRejectedValue(new Error("boom"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
    });

    it("returns 400 when constructing the call throws synchronously", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualReReview.mockImplementation(() => {
        throw new Error("sync failure");
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("sync failure");
    });
  });

  describe("POST /api/runs/:id/actions/revise-plan", () => {
    it("returns 200 and fires runManualPlanRevision in the background", async () => {
      const { app, mockOrchestrator } = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
        payload: { note: "revise it" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1" });
      expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
        note: "revise it",
      });
    });

    it("logs but does not reject the request when the background call fails", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("boom"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
    });

    it("returns 400 when constructing the call throws synchronously", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
        throw new Error("sync failure");
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("sync failure");
    });
  });

  describe("POST /api/runs/:id/actions/approve-review", () => {
    it("returns 200 with the resulting state", async () => {
      const run = makeRun({ state: RunState.Done });
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approveHumanReview.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-review",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, state: RunState.Done });
    });

    it("returns 400 when approveHumanReview throws", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("wrong state"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-review",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("wrong state");
    });
  });

  describe("POST /api/runs/:id/actions/pause", () => {
    it("returns 404 when the run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

      expect(res.statusCode).toBe(404);
    });

    it("calls handleCommand with pause-ai and returns ok", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
        type: "pause-ai",
      });
    });

    it("returns 400 when handleCommand throws", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("cannot pause");
    });
  });

  describe("POST /api/runs/:id/actions/resume", () => {
    it("returns 404 when the run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

      expect(res.statusCode).toBe(404);
    });

    it("calls handleCommand with resume-ai and returns ok", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
        type: "resume-ai",
      });
    });

    it("returns 400 when handleCommand throws", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("cannot resume");
    });
  });

  describe("POST /api/runs/:id/actions/answer-questions (non-Error rejection)", () => {
    it("falls back to String(err) when the orchestrator rejects with a non-Error value", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.answerQuestions.mockRejectedValue("plain string failure");

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/answer-questions",
        payload: { answers: [{ questionId: "q1", answer: "yes" }] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("plain string failure");
    });
  });

  describe("POST /api/runs/:id/actions/retry", () => {
    it("returns 404 when the run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for a non-retryable state", async () => {
      const run = makeRun({ state: RunState.Done });
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Retry is not supported for state "Done"');
    });

    const retryMatrix: [RunState, string][] = [
      [RunState.Todo, "retryRun"],
      [RunState.Planning, "runPlanning"],
      [RunState.PlanRevision, "runPlanRevision"],
      [RunState.PlanReview, "runPlanReview"],
      [RunState.Implementing, "runExecution"],
      [RunState.AIReview, "runReview"],
      [RunState.AddressingReview, "runRemediation"],
    ];

    for (const [state, method] of retryMatrix) {
      it(`triggers orchestrator.${method}() and returns retrying=true for state ${state}`, async () => {
        const run = makeRun({ state });
        const { app, mockRunRepo, mockOrchestrator } = await buildApp();
        mockRunRepo.findById.mockResolvedValue(run);

        const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
        expect(
          (mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[method],
        ).toHaveBeenCalledWith("run-1");
      });
    }

    it("logs but does not reject the request when the retry trigger rejects", async () => {
      const run = makeRun({ state: RunState.Todo });
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockOrchestrator.retryRun.mockRejectedValue(new Error("retry failed"));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
    });

    it("logs String(err) when the retry trigger rejects with a non-Error value", async () => {
      const run = makeRun({ state: RunState.Todo });
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockOrchestrator.retryRun.mockRejectedValue("plain string failure");

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  describe("GET /api/runs/:id/summary", () => {
    it("returns 404 when the run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

      expect(res.statusCode).toBe(404);
    });

    it("returns null plan/planReview/review/executionReport when no artifacts exist", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findLatestByType.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.plan).toBeNull();
      expect(body.planReview).toBeNull();
      expect(body.review).toBeNull();
      expect(body.executionReport).toBeNull();
      expect(body.run.id).toBe("run-1");
      expect(body.run.linearIssue.identifier).toBe("ENG-42");
    });

    it("builds a full summary including string risks, object risks with description, and unknown risks", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
        if (type === "Plan") {
          return {
            id: "art-plan",
            version: 3,
            payloadJson: {
              summary: "Add feature X",
              confidence: 0.85,
              openQuestions: [{ id: "q1", question: "Which auth?", requiredForExecution: true }],
              steps: [{ id: "s1", title: "Step 1", description: "Do thing" }],
              risks: ["plain string risk", { description: "object risk" }, { foo: "bar" }],
              testPlan: "Run unit tests",
            },
          };
        }
        if (type === "PlanReview") {
          return { id: "art-pr", version: 1, payloadJson: { verdict: "approved" } };
        }
        if (type === "Review") {
          return { id: "art-rev", version: 2, payloadJson: { verdict: "pass" } };
        }
        if (type === "ExecutionReport") {
          return {
            id: "art-exec",
            version: 4,
            payloadJson: { executionVersion: 2, score: 0.9, scoreRationale: "solid" },
          };
        }
        return null;
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.plan.summary).toBe("Add feature X");
      expect(body.plan.stepCount).toBe(1);
      expect(body.plan.risks).toEqual(["plain string risk", "object risk", '{"foo":"bar"}']);
      expect(body.plan.riskCount).toBe(3);

      expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
      expect(body.review).toEqual({ version: 2, payload: { verdict: "pass" } });

      expect(body.executionReport.version).toBe(4);
      expect(body.executionReport.executionVersion).toBe(2);
      expect(body.executionReport.score).toBe(0.9);
      expect(body.executionReport.scoreRationale).toBe("solid");
    });

    it("falls back to the artifact version as executionVersion when payload omits it", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return { id: "art-exec", version: 7, payloadJson: null };
        }
        return null;
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.executionReport.executionVersion).toBe(7);
      expect(body.executionReport.score).toBeUndefined();
    });

    it("falls back to String(risk) when a risk object cannot be JSON-stringified", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      const circular: Record<string, unknown> = { foo: "bar" };
      circular.self = circular; // makes JSON.stringify throw

      mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
        if (type === "Plan") {
          return {
            id: "art-plan",
            version: 1,
            payloadJson: { summary: "circular risk", risks: [circular] },
          };
        }
        return null;
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.plan.risks).toHaveLength(1);
      expect(body.plan.risks[0]).toBe(String(circular));
    });

    it("defaults openQuestions/steps/risks to empty arrays when the plan omits them", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
        if (type === "Plan") {
          return { id: "art-plan", version: 1, payloadJson: { summary: "no extras" } };
        }
        return null;
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.plan.openQuestions).toEqual([]);
      expect(body.plan.steps).toEqual([]);
      expect(body.plan.risks).toEqual([]);
      expect(body.plan.stepCount).toBe(0);
    });
  });

  describe("POST /api/runs/:id/actions/request-human (default option branches)", () => {
    it("returns 404 when the run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/missing/actions/request-human",
        payload: { reason: "other", summary: "needs a human" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("uses the default debounceHours/uiBaseUrl, and defaults a null linearIssueIdentifier", async () => {
      const run = makeRun({ linearIssueIdentifier: null });
      const { app, mockRunRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/request-human",
        payload: { reason: "other", summary: "needs a human" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.debounced).toBe(false);

      expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
      const eventArgs = mockEventRepo.create.mock.calls[0][0] as {
        payloadJson: { runUrl: string };
      };
      // Default uiBaseUrl (http://localhost:5173) is used when not configured.
      expect(eventArgs.payloadJson.runUrl).toBe("http://localhost:5173/runs/run-1");
    });

    it("does not debounce when the only prior event has a different eventType", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockEventRepo.findByRunId.mockResolvedValue([
        {
          eventType: "SOME_OTHER_EVENT",
          createdAt: new Date(),
          payloadJson: { reason: "other" },
        },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/request-human",
        payload: { reason: "other", summary: "needs a human" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().debounced).toBe(false);
    });

    it("does not debounce when the matching prior event is outside the debounce window", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockEventRepo } = await buildApp({ debounceHours: 1 });
      mockRunRepo.findById.mockResolvedValue(run);
      mockEventRepo.findByRunId.mockResolvedValue([
        {
          eventType: "HUMAN_REQUESTED",
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago, window is 1h
          payloadJson: { reason: "other" },
        },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/request-human",
        payload: { reason: "other", summary: "needs a human" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().debounced).toBe(false);
    });
  });

  describe("GET /api/processes", () => {
    it("returns all active processes when no runId filter is given", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getActiveProcesses.mockReturnValue([
        { runId: "run-1", processId: "p1" },
        { runId: "run-2", processId: "p2" },
      ]);

      const res = await app.inject({ method: "GET", url: "/api/processes" });

      expect(res.statusCode).toBe(200);
      expect(res.json().processes).toHaveLength(2);
    });

    it("filters by runId when provided", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getActiveProcesses.mockReturnValue([
        { runId: "run-1", processId: "p1" },
        { runId: "run-2", processId: "p2" },
      ]);

      const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.processes).toHaveLength(1);
      expect(body.processes[0].runId).toBe("run-2");
    });
  });

  describe("GET /api/processes/:id/output", () => {
    it("returns 404 when no output is available", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getProcessOutput.mockReturnValue(null);

      const res = await app.inject({ method: "GET", url: "/api/processes/proc-x/output" });

      expect(res.statusCode).toBe(404);
    });

    it("returns the output when available", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

      const res = await app.inject({ method: "GET", url: "/api/processes/proc-x/output" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ processId: "proc-x", output: "some log output" });
    });
  });

  describe("GET /api/linear/pending", () => {
    it("returns 501 when no linearPollService is configured", async () => {
      const { app } = await buildApp();

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(501);
    });

    it("returns the discovered issues when configured", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "issue-1" }]),
        startRunsForIssues: vi.fn(),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ issues: [{ id: "issue-1" }] });
    });

    it("returns 500 when discoverPendingIssues throws", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear API down")),
        startRunsForIssues: vi.fn(),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("linear API down");
    });

    it("returns 500 with String(err) when discoverPendingIssues rejects with a non-Error", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn().mockRejectedValue("plain string failure"),
        startRunsForIssues: vi.fn(),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("plain string failure");
    });
  });

  describe("POST /api/linear/ingest", () => {
    it("returns 501 when no linearPollService is configured", async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["a"] },
      });

      expect(res.statusCode).toBe(501);
    });

    it("returns 400 when issueIds is missing or empty", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn(),
        startRunsForIssues: vi.fn(),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: [] },
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns ok + result when successful", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn(),
        startRunsForIssues: vi.fn().mockResolvedValue({ started: ["issue-1"], skipped: [] }),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["issue-1"] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, started: ["issue-1"], skipped: [] });
      expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["issue-1"]);
    });

    it("returns 500 when startRunsForIssues throws", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn(),
        startRunsForIssues: vi.fn().mockRejectedValue(new Error("db unavailable")),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["issue-1"] },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("db unavailable");
    });

    it("returns 500 with String(err) when startRunsForIssues rejects with a non-Error", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn(),
        startRunsForIssues: vi.fn().mockRejectedValue("plain string failure"),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["issue-1"] },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("plain string failure");
    });
  });

  describe("GET /api/events/stream (SSE)", () => {
    // Rather than opening a real HTTP connection (which proved flaky under
    // the test runner's worker-thread teardown and corrupted coverage
    // collection for the whole file), capture the route handler Fastify
    // registers and drive it directly with lightweight request/reply
    // doubles. This exercises the exact same handler code deterministically.
    async function captureStreamHandler() {
      const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
      const mockArtifactRepo = { findByRunId: vi.fn() };
      const mockEventRepo = { findByRunId: vi.fn() };
      const mockOrchestrator = {
        getRunRepo: () => mockRunRepo,
        getArtifactRepo: () => mockArtifactRepo,
        getEventRepo: () => mockEventRepo,
      };
      const mockProcessRunner = {
        getActiveProcesses: vi.fn().mockReturnValue([]),
        getProcessOutput: vi.fn().mockReturnValue(null),
      };

      const emitter = new RunEventEmitter();
      const app = Fastify({ logger: false });

      let capturedHandler: ((request: unknown, reply: unknown) => void) | undefined;
      const originalGet = app.get.bind(app);
      vi.spyOn(app, "get").mockImplementation((...args: unknown[]) => {
        const [url, handler] = args as [string, (request: unknown, reply: unknown) => void];
        if (url === "/api/events/stream") {
          capturedHandler = handler;
        }
        return (originalGet as (...a: unknown[]) => unknown)(...args) as ReturnType<typeof app.get>;
      });

      registerApiRoutes(app, mockOrchestrator as never, emitter, mockProcessRunner as never);
      await app.ready();

      if (!capturedHandler) {
        throw new Error("Failed to capture the /api/events/stream handler");
      }

      return { emitter, handler: capturedHandler };
    }

    function makeFakeReply() {
      const writeHead = vi.fn();
      const write = vi.fn();
      return { raw: { writeHead, write } };
    }

    function makeFakeRequest() {
      const raw = new EventEmitter();
      return { raw };
    }

    it("writes SSE headers and an initial heartbeat comment", async () => {
      const { handler } = await captureStreamHandler();
      const reply = makeFakeReply();
      const request = makeFakeRequest();

      handler(request, reply);

      expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    });

    it("forwards emitted dashboard events to the client as SSE data frames", async () => {
      const { emitter, handler } = await captureStreamHandler();
      const reply = makeFakeReply();
      const request = makeFakeRequest();

      handler(request, reply);
      reply.raw.write.mockClear();

      emitter.emitRunCreated("run-xyz", "issue-9", "org/repo");

      expect(reply.raw.write).toHaveBeenCalledTimes(1);
      const [frame] = reply.raw.write.mock.calls[0] as [string];
      expect(frame.startsWith("data: ")).toBe(true);
      expect(frame.endsWith("\n\n")).toBe(true);
      const payload = JSON.parse(frame.slice("data: ".length, -2)) as DashboardEvent;
      expect(payload).toMatchObject({
        type: "run:created",
        runId: "run-xyz",
        issueId: "issue-9",
        repo: "org/repo",
      });
    });

    it("removes the dashboard listener when the client disconnects", async () => {
      const { emitter, handler } = await captureStreamHandler();
      const reply = makeFakeReply();
      const request = makeFakeRequest();

      handler(request, reply);
      expect(emitter.listenerCount("dashboard")).toBe(1);

      (request.raw as EventEmitter).emit("close");

      expect(emitter.listenerCount("dashboard")).toBe(0);

      // Events emitted after disconnect must not reach the (removed) handler.
      reply.raw.write.mockClear();
      emitter.emitRunCreated("run-after-close", "issue-1", "org/repo");
      expect(reply.raw.write).not.toHaveBeenCalled();
    });

    it("sends periodic heartbeat comments and stops them after disconnect", async () => {
      vi.useFakeTimers();
      try {
        const { handler } = await captureStreamHandler();
        const reply = makeFakeReply();
        const request = makeFakeRequest();

        handler(request, reply);
        reply.raw.write.mockClear();

        vi.advanceTimersByTime(15_000);
        expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");

        (request.raw as EventEmitter).emit("close");
        reply.raw.write.mockClear();

        vi.advanceTimersByTime(60_000);
        expect(reply.raw.write).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not throw when the client disconnects more than once", async () => {
      const { handler } = await captureStreamHandler();
      const reply = makeFakeReply();
      const request = makeFakeRequest();

      handler(request, reply);

      expect(() => {
        (request.raw as EventEmitter).emit("close");
        (request.raw as EventEmitter).emit("close");
      }).not.toThrow();
    });
  });
});
