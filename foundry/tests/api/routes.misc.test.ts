import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
    repo: "test-repo",
    branchName: "ai/lin-1",
    prNumber: 42,
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

function buildOrchestratorMocks() {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
  };

  return { mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo };
}

async function buildApp(opts: {
  orchestratorOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown>;
} = {}) {
  const { mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo } =
    buildOrchestratorMocks();
  Object.assign(mockOrchestrator, opts.orchestratorOverrides ?? {});

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
    opts.linearPollService as never,
  );
  await app.ready();

  return { app, mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo, mockProcessRunner };
}

describe("routes.ts — remaining endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/runs", () => {
    it("returns all runs from the repository", async () => {
      const { app, mockRunRepo } = await buildApp();
      const runs = [makeRun(), makeRun({ id: "run-2" })];
      mockRunRepo.findAll.mockResolvedValue(runs);

      const res = await app.inject({ method: "GET", url: "/api/runs" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(JSON.parse(JSON.stringify({ runs })));
      expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    });

    it("forwards the state querystring filter to the repository", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findAll.mockResolvedValue([]);

      await app.inject({ method: "GET", url: "/api/runs?state=Done" });

      expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
    });
  });

  describe("GET /api/runs/:id", () => {
    it("returns the run with its artifacts and events", async () => {
      const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
      const run = makeRun();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { run: unknown; artifacts: unknown[]; events: unknown[] };
      expect(body.run).toMatchObject({ id: "run-1" });
      expect(body.artifacts).toEqual([{ id: "art-1" }]);
      expect(body.events).toEqual([{ id: "evt-1" }]);
    });

    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Run not found" });
    });
  });

  describe("GET /api/runs/:id/artifacts", () => {
    it("returns artifacts for an existing run", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1", type: "Plan" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ artifacts: [{ id: "art-1", type: "Plan" }] });
    });

    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/runs/:id/events", () => {
    it("returns events for an existing run", async () => {
      const { app, mockRunRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1", eventType: "PLAN_CREATED" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ events: [{ id: "evt-1", eventType: "PLAN_CREATED" }] });
    });

    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/runs/:id/actions/approve-plan", () => {
    it("approves the plan, triggers execution, and returns ok+state", async () => {
      const run = makeRun({ state: RunState.Implementing });
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approvePlan.mockResolvedValue(run);
      mockOrchestrator.runExecution.mockResolvedValue(undefined);

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

    it("does not fail the request when the background runExecution() call rejects", async () => {
      const run = makeRun({ state: RunState.Implementing });
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approvePlan.mockResolvedValue(run);
      mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
    });

    it("returns 400 when approvePlan rejects", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approvePlan.mockRejectedValue(new Error("Plan not approvable"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Plan not approvable" });
    });
  });

  describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
    it("returns 400 for an invalid mode value", async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/reject-plan",
        payload: { mode: "bogus" },
      });

      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("mode must be one of");
    });

    it("accepts mode='fresh' and forwards it to the orchestrator", async () => {
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
    it("fires the manual re-review in the background and returns immediately", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualReReview.mockResolvedValue(makeRun());

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

    it("does not fail the request when the background call rejects", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualReReview.mockRejectedValue(new Error("boom"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
      });

      expect(res.statusCode).toBe(200);
    });

    it("returns 400 when orchestrator.runManualReReview throws synchronously", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualReReview.mockImplementation(() => {
        throw new Error("synchronous failure");
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "synchronous failure" });
    });
  });

  describe("POST /api/runs/:id/actions/revise-plan", () => {
    it("fires the manual plan revision in the background and returns immediately", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualPlanRevision.mockResolvedValue(makeRun());

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

    it("does not fail the request when the background call rejects", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("boom"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
      });

      expect(res.statusCode).toBe(200);
    });

    it("returns 400 when orchestrator.runManualPlanRevision throws synchronously", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
        throw new Error("synchronous failure");
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "synchronous failure" });
    });
  });

  describe("POST /api/runs/:id/actions/approve-review", () => {
    it("returns ok+state on success", async () => {
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

    it("returns 400 when approveHumanReview rejects", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("Not ready for review"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-review",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Not ready for review" });
    });
  });

  describe("POST /api/runs/:id/actions/pause", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

      expect(res.statusCode).toBe(404);
    });

    it("calls handleCommand with pause-ai and returns ok", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
    });

    it("returns 400 when handleCommand rejects", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "cannot pause" });
    });
  });

  describe("POST /api/runs/:id/actions/resume", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

      expect(res.statusCode).toBe(404);
    });

    it("calls handleCommand with resume-ai and returns ok", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

      expect(res.statusCode).toBe(200);
      expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
    });

    it("returns 400 when handleCommand rejects", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "cannot resume" });
    });
  });

  describe("POST /api/runs/:id/actions/retry", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

      expect(res.statusCode).toBe(404);
    });

    it.each([
      [RunState.Todo, "retryRun"],
      [RunState.Planning, "runPlanning"],
      [RunState.PlanRevision, "runPlanRevision"],
      [RunState.PlanReview, "runPlanReview"],
      [RunState.Implementing, "runExecution"],
      [RunState.AIReview, "runReview"],
      [RunState.AddressingReview, "runRemediation"],
    ] as const)("retries state %s by invoking orchestrator.%s", async (state, method) => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state }));
      (mockOrchestrator[method] as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(mockOrchestrator[method]).toHaveBeenCalledWith("run-1");
    });

    it("returns 400 for a non-retryable state", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain("Retry is not supported");
    });

    it("does not fail the request when the background retry call rejects", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
      mockOrchestrator.retryRun.mockRejectedValue(new Error("boom"));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /api/runs/:id/summary", () => {
    it("returns 404 when the run does not exist", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

      expect(res.statusCode).toBe(404);
    });

    it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.plan).toBeNull();
      expect(body.planReview).toBeNull();
      expect(body.review).toBeNull();
      expect(body.executionReport).toBeNull();
      expect((body.run as { id: string }).id).toBe("run-1");
    });

    it("assembles a full summary from the latest Plan/PlanReview/Review/ExecutionReport artifacts", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());

      const circular: Record<string, unknown> = {};
      circular.self = circular;

      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({
            version: 2,
            payloadJson: {
              summary: "Plan summary",
              confidence: 0.75,
              openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: true }],
              steps: [{ id: "s1", title: "Step", description: "Do it" }],
              risks: ["string risk", { description: "object risk" }, { other: "x" }, circular],
              testPlan: "Run the tests",
            },
          });
        }
        if (type === "PlanReview") {
          return Promise.resolve({ version: 1, payloadJson: { verdict: "approved" } });
        }
        if (type === "Review") {
          return Promise.resolve({ version: 1, payloadJson: { overallVerdict: "approved" } });
        }
        if (type === "ExecutionReport") {
          return Promise.resolve({
            version: 1,
            payloadJson: { executionVersion: 1, score: 0.9, scoreRationale: "Great" },
          });
        }
        return Promise.resolve(null);
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        plan: { summary: string; riskCount: number; risks: string[]; stepCount: number };
        planReview: { payload: { verdict: string } };
        review: { payload: { overallVerdict: string } };
        executionReport: { score: number; scoreRationale: string; executionVersion: number };
      };
      expect(body.plan.summary).toBe("Plan summary");
      expect(body.plan.stepCount).toBe(1);
      expect(body.plan.riskCount).toBe(4);
      expect(body.plan.risks[0]).toBe("string risk");
      expect(body.plan.risks[1]).toBe("object risk");
      expect(body.plan.risks[2]).toBe(JSON.stringify({ other: "x" }));
      expect(body.plan.risks[3]).toBe("[object Object]");
      expect(body.planReview.payload.verdict).toBe("approved");
      expect(body.review.payload.overallVerdict).toBe("approved");
      expect(body.executionReport.score).toBe(0.9);
      expect(body.executionReport.scoreRationale).toBe("Great");
      expect(body.executionReport.executionVersion).toBe(1);
    });

    it("falls back to the artifact version for executionVersion when payload omits it", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({ version: 7, payloadJson: null });
        }
        return Promise.resolve(null);
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      const body = res.json() as { executionReport: { executionVersion: number } };
      expect(body.executionReport.executionVersion).toBe(7);
    });

    it("defaults steps to an empty array when the plan payload has no steps field", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({ version: 1, payloadJson: { summary: "No steps here" } });
        }
        return Promise.resolve(null);
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      const body = res.json() as { plan: { steps: unknown[]; stepCount: number } };
      expect(body.plan.steps).toEqual([]);
      expect(body.plan.stepCount).toBe(0);
    });
  });

  describe("GET /api/processes", () => {
    it("returns all active processes when no runId filter is given", async () => {
      const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

      const res = await app.inject({ method: "GET", url: "/api/processes" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ processes });
    });

    it("filters by runId when provided", async () => {
      const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

      const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ processes: [{ id: "p2", runId: "run-2" }] });
    });
  });

  describe("GET /api/processes/:id/output", () => {
    it("returns 404 when there is no output for the process", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getProcessOutput.mockReturnValue(null);

      const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

      expect(res.statusCode).toBe(404);
    });

    it("returns the process output when available", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

      const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ processId: "p1", output: "some log output" });
    });
  });

  describe("GET /api/linear/pending", () => {
    it("returns 501 when no linearPollService is configured", async () => {
      const { app } = await buildApp();

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(501);
    });

    it("returns the discovered issues on success", async () => {
      const issues = [{ id: "LIN-1" }];
      const linearPollService = { discoverPendingIssues: vi.fn().mockResolvedValue(issues) };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ issues });
    });

    it("returns 500 when discovery fails", async () => {
      const linearPollService = {
        discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API down")),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "Linear API down" });
    });
  });

  describe("POST /api/linear/ingest", () => {
    it("returns 501 when no linearPollService is configured", async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(res.statusCode).toBe(501);
    });

    it("returns 400 when issueIds is missing or empty", async () => {
      const linearPollService = { startRunsForIssues: vi.fn() };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: [] },
      });

      expect(res.statusCode).toBe(400);
      expect(linearPollService.startRunsForIssues).not.toHaveBeenCalled();
    });

    it("starts runs for the given issue ids on success", async () => {
      const linearPollService = {
        startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"] }),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, started: ["LIN-1"] });
      expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
    });

    it("returns 500 when startRunsForIssues rejects", async () => {
      const linearPollService = {
        startRunsForIssues: vi.fn().mockRejectedValue(new Error("db error")),
      };
      const { app } = await buildApp({ linearPollService });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "db error" });
    });
  });

  describe("POST /api/runs/:id/chat — workingDirectory fallback", () => {
    async function buildChatApp(workingDirectory: string) {
      const { mockOrchestrator, mockRunRepo, mockArtifactRepo } = buildOrchestratorMocks();
      mockRunRepo.findById.mockResolvedValue(makeRun({ workingDirectory }));
      (mockArtifactRepo as unknown as { create: ReturnType<typeof vi.fn> }).create = vi
        .fn()
        .mockResolvedValue({ id: "artifact-1" });

      const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
      const mockProcessRunner = {
        getActiveProcesses: vi.fn().mockReturnValue([]),
        getProcessOutput: vi.fn().mockReturnValue(null),
      };
      const claudeCodeRunner = {
        chatRun: vi.fn().mockResolvedValue({ text: "reply", durationMs: 10 }),
      };

      const app = Fastify({ logger: false });
      registerApiRoutes(
        app,
        mockOrchestrator as never,
        mockEmitter as never,
        mockProcessRunner as never,
        undefined,
        { claudeCodeRunner: claudeCodeRunner as never },
      );
      await app.ready();

      return { app, claudeCodeRunner, mockArtifactRepo };
    }

    it("returns 422 when the working directory is gone and has no /.worktrees/ segment to fall back to", async () => {
      const { app, claudeCodeRunner } = await buildChatApp("/definitely/not/a/real/path/xyz");

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "Hello" },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({
        error: "Working directory not found — the repository may have been removed",
      });
      expect(claudeCodeRunner.chatRun).not.toHaveBeenCalled();
    });

    it("falls back to the main repo path when the worktree under /.worktrees/ is gone but the repo root still exists", async () => {
      const repoRoot = mkdtempSync(join(tmpdir(), "routes-misc-chat-fallback-"));
      const staleWorktreePath = join(repoRoot, ".worktrees", "stale-branch-dir");

      const { app, claudeCodeRunner } = await buildChatApp(staleWorktreePath);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "Hello" },
      });

      expect(res.statusCode).toBe(200);
      expect(claudeCodeRunner.chatRun).toHaveBeenCalledOnce();
      const [input] = claudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
      expect(input.workingDirectory).toBe(repoRoot);
    });
  });

  describe("GET /api/events/stream (SSE)", () => {
    function buildFakeApp() {
      const routeHandlers = new Map<string, (request: unknown, reply: unknown) => void>();
      const fakeApp = {
        get: (path: string, handler: (request: unknown, reply: unknown) => void) => {
          routeHandlers.set(`GET ${path}`, handler);
        },
        post: () => {},
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
      };
      return { fakeApp, routeHandlers };
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("writes SSE headers, an initial comment, and streams dashboard events until the client disconnects", async () => {
      const { fakeApp, routeHandlers } = buildFakeApp();
      const { mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo } =
        buildOrchestratorMocks();
      void mockRunRepo;
      void mockArtifactRepo;
      void mockEventRepo;

      const emitter = { on: vi.fn(), off: vi.fn() };
      const processRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

      registerApiRoutes(
        fakeApp as never,
        mockOrchestrator as never,
        emitter as never,
        processRunner as never,
      );

      const handler = routeHandlers.get("GET /api/events/stream");
      expect(handler).toBeDefined();

      const rawRequest = new EventEmitter();
      const writeHead = vi.fn();
      const write = vi.fn();
      const reply = { raw: { writeHead, write } };
      const request = { raw: rawRequest };

      handler!(request, reply);

      expect(writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      expect(write).toHaveBeenCalledWith(":\n\n");
      expect(emitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

      // Simulate the orchestrator emitting a dashboard event.
      const dashboardHandler = emitter.on.mock.calls[0][1] as (event: unknown) => void;
      dashboardHandler({ type: "RUN_UPDATED", runId: "run-1" });
      expect(write).toHaveBeenCalledWith(
        `data: ${JSON.stringify({ type: "RUN_UPDATED", runId: "run-1" })}\n\n`,
      );

      // Heartbeat fires every 15s.
      vi.advanceTimersByTime(15_000);
      expect(write).toHaveBeenCalledWith(":\n\n");

      // Client disconnects: cleanup unregisters the dashboard listener and stops the heartbeat.
      rawRequest.emit("close");
      expect(emitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

      const writeCallsBeforeAdvance = write.mock.calls.length;
      vi.advanceTimersByTime(60_000);
      expect(write.mock.calls.length).toBe(writeCallsBeforeAdvance);
    });
  });
});
