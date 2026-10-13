import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
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
  });

  describe("GET /api/events/stream (SSE)", () => {
    let app: FastifyInstance;
    let emitter: RunEventEmitter;

    afterEach(async () => {
      if (app) {
        await app.close();
      }
    });

    it("streams dashboard events to the client and cleans up the listener on disconnect", async () => {
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

      emitter = new RunEventEmitter();
      app = Fastify({ logger: false });
      registerApiRoutes(app, mockOrchestrator as never, emitter, mockProcessRunner as never);
      await app.listen({ port: 0, host: "127.0.0.1" });

      const address = app.server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected a network address for the test server");
      }
      const { port } = address;

      const received: string[] = [];
      const streamClosed = new Promise<void>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/api/events/stream`, (res) => {
          expect(res.headers["content-type"]).toBe("text/event-stream");
          expect(res.headers["cache-control"]).toBe("no-cache");

          res.on("data", (chunk: Buffer) => {
            received.push(chunk.toString("utf8"));
            // Once we've seen the initial heartbeat, emit a real event and
            // then close the connection from the client side.
            if (received.join("").includes(":\n\n") && emitter.listenerCount("dashboard") === 1) {
              emitter.emitRunCreated("run-xyz", "issue-9", "org/repo");
            }
            if (received.join("").includes("run:created")) {
              req.destroy();
            }
          });

          res.on("close", () => resolve());
        });
        req.on("error", () => resolve());
      });

      await streamClosed;

      const combined = received.join("");
      expect(combined).toContain("run:created");
      expect(combined).toContain("run-xyz");

      // Give the server's 'close' handler a tick to run emitter.off().
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(emitter.listenerCount("dashboard")).toBe(0);
    });
  });
});
