import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
    linearIssueUrl: "https://linear.app/team/issue/ENG-42",
    repo: "test/repo",
    branchName: "ai/lin-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/nonexistent-workdir-for-tests",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface BuildAppOptions {
  orchestratorOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown> | undefined;
  registerOptions?: Record<string, unknown>;
}

function buildApp(opts: BuildAppOptions = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "artifact-x" }),
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
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
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
    opts.registerOptions ?? {},
  );

  return {
    app,
    mockRunRepo,
    mockArtifactRepo,
    mockEventRepo,
    mockOrchestrator,
    mockEmitter,
    mockProcessRunner,
  };
}

describe("routes.ts — remaining route coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/runs", () => {
    it("returns all runs when no state query param is given", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findAll.mockResolvedValue([makeRun()]);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs" });

      expect(res.statusCode).toBe(200);
      expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
      const body = res.json() as { runs: unknown[] };
      expect(body.runs).toHaveLength(1);
    });

    it("passes the state query param through to findAll", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findAll.mockResolvedValue([]);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs?state=Done" });

      expect(res.statusCode).toBe(200);
      expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
    });
  });

  describe("GET /api/runs/:id", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(null);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Run not found" });
    });

    it("returns run, artifacts, and events when found", async () => {
      const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = buildApp();
      const run = makeRun();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
      expect(body.run.id).toBe("run-1");
      expect(body.artifacts).toEqual([{ id: "art-1" }]);
      expect(body.events).toEqual([{ id: "evt-1" }]);
    });
  });

  describe("GET /api/runs/:id/artifacts", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(null);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

      expect(res.statusCode).toBe(404);
    });

    it("returns the run's artifacts when found", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }, { id: "art-2" }]);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { artifacts: unknown[] }).artifacts).toHaveLength(2);
    });
  });

  describe("GET /api/runs/:id/events", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(null);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

      expect(res.statusCode).toBe(404);
    });

    it("returns the run's events when found", async () => {
      const { app, mockRunRepo, mockEventRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { events: unknown[] }).events).toEqual([{ id: "evt-1" }]);
    });
  });

  describe("POST /api/runs/:id/chat — working directory fallback", () => {
    let realDir: string;

    beforeEach(() => {
      realDir = mkdtempSync(join(tmpdir(), "routes-remaining-chat-"));
    });

    afterEach(() => {
      rmSync(realDir, { recursive: true, force: true });
    });

    it("falls back to the base repo dir when workingDirectory is a missing worktree path", async () => {
      const chatRun = vi.fn().mockResolvedValue({ text: "reply", durationMs: 10 });
      const { app, mockRunRepo } = buildApp({
        registerOptions: { claudeCodeRunner: { chatRun } },
      });
      mockRunRepo.findById.mockResolvedValue(
        makeRun({ workingDirectory: join(realDir, ".worktrees", "run-1") }),
      );
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "hi" },
      });

      expect(res.statusCode).toBe(200);
      expect(chatRun).toHaveBeenCalledOnce();
      const [input] = chatRun.mock.calls[0] as [{ workingDirectory: string }];
      expect(input.workingDirectory).toBe(realDir);
    });

    it("returns 422 when neither the worktree nor the fallback base dir exists", async () => {
      const chatRun = vi.fn();
      const { app, mockRunRepo } = buildApp({
        registerOptions: { claudeCodeRunner: { chatRun } },
      });
      mockRunRepo.findById.mockResolvedValue(
        makeRun({ workingDirectory: "/tmp/totally-missing-repo/.worktrees/run-1" }),
      );
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "hi" },
      });

      expect(res.statusCode).toBe(422);
      expect(chatRun).not.toHaveBeenCalled();
    });

    it("returns 422 when workingDirectory is missing and has no .worktrees segment to fall back from", async () => {
      const chatRun = vi.fn();
      const { app, mockRunRepo } = buildApp({
        registerOptions: { claudeCodeRunner: { chatRun } },
      });
      mockRunRepo.findById.mockResolvedValue(
        makeRun({ workingDirectory: "/tmp/no-such-dir-at-all" }),
      );
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "hi" },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({
        error: "Working directory not found — the repository may have been removed",
      });
    });
  });

  describe("POST /api/runs/:id/actions/approve-plan", () => {
    it("sanitizes the note, approves the plan, and fires execution in the background", async () => {
      const run = makeRun({ state: RunState.Implementing });
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.approvePlan.mockResolvedValue(run);
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: { note: "  looks good  " },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, state: run.state });
      expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
      expect(mockOrchestrator.runExecution).toHaveBeenCalledWith(run.id, {
        note: "looks good",
      });
    });

    it("returns 400 when approvePlan throws", async () => {
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.approvePlan.mockRejectedValue(new Error("Cannot approve in this state"));
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Cannot approve in this state" });
    });

    it("does not fail the request when the background runExecution rejects", async () => {
      const run = makeRun({ state: RunState.Implementing });
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.approvePlan.mockResolvedValue(run);
      mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      // Give the fire-and-forget rejection a tick to be handled by .catch().
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
    it("returns 400 for an invalid mode value", async () => {
      const { app } = buildApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/reject-plan",
        payload: { mode: "bogus" },
      });

      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("mode must be one of");
    });

    it("accepts mode='fresh' and forwards it to rejectPlan", async () => {
      const run = makeRun();
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.rejectPlan.mockResolvedValue(run);
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/reject-plan",
        payload: { mode: "fresh", context: "start over" },
      });

      expect(res.statusCode).toBe(200);
      expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith(
        "run-1",
        "start over",
        "api",
        "fresh",
      );
    });
  });

  describe("POST /api/runs/:id/actions/re-review-plan", () => {
    it("returns 200 with ok and runId, firing runManualReReview in the background", async () => {
      const { app, mockOrchestrator } = buildApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
        payload: { note: "double-check the risk section" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1" });
      expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
        note: "double-check the risk section",
      });
    });

    it("returns 400 when runManualReReview throws synchronously", async () => {
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.runManualReReview.mockImplementation(() => {
        throw new Error("cannot start re-review");
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "cannot start re-review" });
    });

    it("does not fail the request when the background call rejects", async () => {
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.runManualReReview.mockRejectedValue(new Error("boom"));
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  describe("POST /api/runs/:id/actions/revise-plan", () => {
    it("returns 200 with ok and runId, firing runManualPlanRevision in the background", async () => {
      const { app, mockOrchestrator } = buildApp();
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
        payload: { note: "tighten scope" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1" });
      expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
        note: "tighten scope",
      });
    });

    it("returns 400 when runManualPlanRevision throws synchronously", async () => {
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
        throw new Error("cannot start revision");
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "cannot start revision" });
    });

    it("does not fail the request when the background call rejects", async () => {
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("boom"));
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  describe("POST /api/runs/:id/actions/approve-review", () => {
    it("returns 200 and the updated state on success", async () => {
      const run = makeRun({ state: RunState.Done });
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.approveHumanReview.mockResolvedValue(run);
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-review",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, state: run.state });
    });

    it("returns 400 when approveHumanReview throws", async () => {
      const { app, mockOrchestrator } = buildApp();
      mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("wrong state"));
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-review",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "wrong state" });
    });
  });

  describe("POST /api/runs/:id/actions/pause", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(null);
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

      expect(res.statusCode).toBe(404);
    });

    it("calls handleCommand with pause-ai and returns ok", async () => {
      const { app, mockRunRepo, mockOrchestrator } = buildApp();
      const run = makeRun({ linearIssueId: "LIN-99" });
      mockRunRepo.findById.mockResolvedValue(run);
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-99", {
        type: "pause-ai",
      });
    });

    it("returns 400 when handleCommand throws", async () => {
      const { app, mockRunRepo, mockOrchestrator } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockOrchestrator.handleCommand.mockRejectedValue(new Error("already paused"));
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "already paused" });
    });
  });

  describe("POST /api/runs/:id/actions/resume", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(null);
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

      expect(res.statusCode).toBe(404);
    });

    it("calls handleCommand with resume-ai and returns ok", async () => {
      const { app, mockRunRepo, mockOrchestrator } = buildApp();
      const run = makeRun({ linearIssueId: "LIN-99" });
      mockRunRepo.findById.mockResolvedValue(run);
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-99", {
        type: "resume-ai",
      });
    });

    it("returns 400 when handleCommand throws", async () => {
      const { app, mockRunRepo, mockOrchestrator } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockOrchestrator.handleCommand.mockRejectedValue(new Error("not paused"));
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "not paused" });
    });
  });

  describe("POST /api/runs/:id/actions/retry", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(null);
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for a non-retryable state", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("Retry is not supported");
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

    it.each(retryMatrix)(
      "triggers %s -> orchestrator.%s() and returns ok/retrying",
      async (state, methodName) => {
        const { app, mockRunRepo, mockOrchestrator } = buildApp();
        mockRunRepo.findById.mockResolvedValue(makeRun({ state }));
        await app.ready();

        const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { ok: boolean; runId: string; state: string; retrying: boolean };
        expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
        expect(
          (mockOrchestrator as unknown as Record<string, ReturnType<typeof vi.fn>>)[methodName],
        ).toHaveBeenCalledWith("run-1");
      },
    );

    it("logs but does not fail the request when the retried stage rejects", async () => {
      const { app, mockRunRepo, mockOrchestrator } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
      mockOrchestrator.retryRun.mockRejectedValue(new Error("stage failed"));
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  describe("GET /api/runs/:id/summary", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(null);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

      expect(res.statusCode).toBe(404);
    });

    it("returns plan: null when there is no Plan artifact", async () => {
      const { app, mockRunRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { plan: unknown; planReview: unknown; review: unknown; executionReport: unknown };
      expect(body.plan).toBeNull();
      expect(body.planReview).toBeNull();
      expect(body.review).toBeNull();
      expect(body.executionReport).toBeNull();
    });

    it("summarizes risks as plain strings, objects-with-description, and JSON-stringified objects", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({
            id: "plan-1",
            version: 2,
            payloadJson: {
              summary: "Plan summary",
              confidence: 0.7,
              openQuestions: [],
              steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
              risks: ["Plain string risk", { description: "Object risk" }, { code: "no-description" }],
              testPlan: "Run tests",
            },
          });
        }
        return Promise.resolve(null);
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        plan: { risks: string[]; riskCount: number; stepCount: number; steps: unknown[] };
      };
      expect(body.plan.risks).toEqual([
        "Plain string risk",
        "Object risk",
        JSON.stringify({ code: "no-description" }),
      ]);
      expect(body.plan.riskCount).toBe(3);
      expect(body.plan.stepCount).toBe(1);
    });

    it("returns an empty steps array when the plan payload's steps field is not an array", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({
            id: "plan-1",
            version: 1,
            payloadJson: {
              summary: "Plan summary",
              confidence: 0.6,
              // `steps` intentionally omitted to exercise the non-array fallback.
              risks: [],
              testPlan: "Run tests",
            },
          });
        }
        return Promise.resolve(null);
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { plan: { steps: unknown[]; stepCount: number } };
      expect(body.plan.steps).toEqual([]);
      expect(body.plan.stepCount).toBe(0);
    });

    it("falls back to String(r) when JSON.stringify throws on a circular risk object", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      const circular: Record<string, unknown> = { note: "circular" };
      circular.self = circular;
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({
            id: "plan-1",
            version: 1,
            payloadJson: {
              summary: "s",
              confidence: 0.5,
              steps: [],
              risks: [circular],
              testPlan: "t",
            },
          });
        }
        return Promise.resolve(null);
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { plan: { risks: string[] } };
      expect(body.plan.risks).toEqual([String(circular)]);
    });

    it("includes planReview and review payloads when present", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "PlanReview") {
          return Promise.resolve({ version: 1, payloadJson: { summary: "plan review" } });
        }
        if (type === "Review") {
          return Promise.resolve({ version: 1, payloadJson: { summary: "code review" } });
        }
        return Promise.resolve(null);
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        planReview: { version: number; payload: { summary: string } };
        review: { version: number; payload: { summary: string } };
      };
      expect(body.planReview.payload.summary).toBe("plan review");
      expect(body.review.payload.summary).toBe("code review");
    });

    it("uses executionReport.payload fields when present, else falls back to artifact.version", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({
            version: 3,
            payloadJson: { executionVersion: 5, score: 0.9, scoreRationale: "great" },
          });
        }
        return Promise.resolve(null);
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      const body = res.json() as {
        executionReport: { version: number; executionVersion: number; score: number };
      };
      expect(body.executionReport.version).toBe(3);
      expect(body.executionReport.executionVersion).toBe(5);
      expect(body.executionReport.score).toBe(0.9);
    });

    it("falls back to the artifact's own version when executionVersion is absent from the payload", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({ version: 4, payloadJson: null });
        }
        return Promise.resolve(null);
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      const body = res.json() as { executionReport: { version: number; executionVersion: number } };
      expect(body.executionReport.version).toBe(4);
      expect(body.executionReport.executionVersion).toBe(4);
    });
  });

  describe("GET /api/processes", () => {
    it("returns all active processes when no runId filter given", async () => {
      const { app, mockProcessRunner } = buildApp();
      mockProcessRunner.getActiveProcesses.mockReturnValue([
        { id: "p1", runId: "run-1" },
        { id: "p2", runId: "run-2" },
      ]);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/processes" });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { processes: unknown[] }).processes).toHaveLength(2);
    });

    it("filters by runId when the query param is given", async () => {
      const { app, mockProcessRunner } = buildApp();
      mockProcessRunner.getActiveProcesses.mockReturnValue([
        { id: "p1", runId: "run-1" },
        { id: "p2", runId: "run-2" },
      ]);
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { processes: { id: string }[] };
      expect(body.processes).toHaveLength(1);
      expect(body.processes[0].id).toBe("p2");
    });
  });

  describe("GET /api/processes/:id/output", () => {
    it("returns 404 when no output is available", async () => {
      const { app } = buildApp();
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

      expect(res.statusCode).toBe(404);
    });

    it("returns the process output when available", async () => {
      const { app, mockProcessRunner } = buildApp();
      mockProcessRunner.getProcessOutput.mockReturnValue("some log output");
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ processId: "p1", output: "some log output" });
    });
  });

  describe("GET /api/linear/pending", () => {
    it("returns 501 when linearPollService is not configured", async () => {
      const { app } = buildApp({ linearPollService: undefined });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(501);
    });

    it("returns discovered issues on success", async () => {
      const discoverPendingIssues = vi.fn().mockResolvedValue([{ id: "LIN-1" }]);
      const { app } = buildApp({
        linearPollService: { discoverPendingIssues, startRunsForIssues: vi.fn() },
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ issues: [{ id: "LIN-1" }] });
    });

    it("returns 500 when discoverPendingIssues throws", async () => {
      const discoverPendingIssues = vi.fn().mockRejectedValue(new Error("Linear API down"));
      const { app } = buildApp({
        linearPollService: { discoverPendingIssues, startRunsForIssues: vi.fn() },
      });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "Linear API down" });
    });
  });

  describe("POST /api/linear/ingest", () => {
    it("returns 501 when linearPollService is not configured", async () => {
      const { app } = buildApp({ linearPollService: undefined });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(res.statusCode).toBe(501);
    });

    it("returns 400 when issueIds is missing or empty", async () => {
      const { app } = buildApp({
        linearPollService: { discoverPendingIssues: vi.fn(), startRunsForIssues: vi.fn() },
      });
      await app.ready();

      const res1 = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
      expect(res1.statusCode).toBe(400);

      const res2 = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: [] },
      });
      expect(res2.statusCode).toBe(400);
    });

    it("returns the started/skipped result on success", async () => {
      const startRunsForIssues = vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] });
      const { app } = buildApp({
        linearPollService: { discoverPendingIssues: vi.fn(), startRunsForIssues },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
      expect(startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
    });

    it("returns 500 when startRunsForIssues throws", async () => {
      const startRunsForIssues = vi.fn().mockRejectedValue(new Error("DB write failed"));
      const { app } = buildApp({
        linearPollService: { discoverPendingIssues: vi.fn(), startRunsForIssues },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "DB write failed" });
    });
  });

  describe("GET /api/events/stream (SSE)", () => {
    let app: FastifyInstance | undefined;

    afterEach(async () => {
      if (app) {
        await app.close();
        app = undefined;
      }
    });

    it("writes an initial heartbeat and streams dashboard events to connected clients", async () => {
      const emitter = new RunEventEmitter();
      const mockOrchestrator = {
        getRunRepo: () => ({ findById: vi.fn(), findAll: vi.fn() }),
        getArtifactRepo: () => ({ findByRunId: vi.fn(), findLatestByType: vi.fn() }),
        getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
      };
      const mockProcessRunner = {
        getActiveProcesses: vi.fn().mockReturnValue([]),
        getProcessOutput: vi.fn().mockReturnValue(null),
      };
      // Uses a real RunEventEmitter (not a plain on/off mock) so
      // `.on("dashboard", ...)` actually wires up and events are observable.
      const sseApp = Fastify({ logger: false });
      registerApiRoutes(
        sseApp,
        mockOrchestrator as never,
        emitter as never,
        mockProcessRunner as never,
      );
      await sseApp.ready();
      await sseApp.listen({ port: 0, host: "127.0.0.1" });
      app = sseApp;

      const address = sseApp.server.address() as AddressInfo;
      const chunks: Buffer[] = [];

      const received = await new Promise<string>((resolve, reject) => {
        const req = http.get(
          { host: "127.0.0.1", port: address.port, path: "/api/events/stream" },
          (res) => {
            res.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
              const combined = Buffer.concat(chunks).toString("utf8");
              if (combined.includes('"type":"run:state-changed"')) {
                req.destroy();
                resolve(combined);
              }
            });
            res.on("error", reject);
          },
        );
        req.on("error", (err: NodeJS.ErrnoException) => {
          // Destroying the request after we got what we needed triggers ECONNRESET;
          // anything else is a genuine failure.
          if (err.code !== "ECONNRESET") reject(err);
        });

        // Give the server a moment to register the SSE handler, then emit an event.
        setTimeout(() => {
          emitter.emitStateChanged("run-1", "Todo", "Planning");
        }, 50);
      });

      expect(received).toContain('"type":"run:state-changed"');
      expect(received).toContain('"runId":"run-1"');
      expect(received).toContain('"from":"Todo"');
      expect(received).toContain('"to":"Planning"');
    });
  });
});
