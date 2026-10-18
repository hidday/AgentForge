import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import http from "node:http";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyError, ValidationError } from "../../src/utils/errors.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Add auth middleware",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "main",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function buildMockOrchestrator(overrides: Record<string, unknown> = {}) {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "artifact-1" }),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "event-1" }),
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
    runPlanning: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    retryRun: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    getLinearClient: vi.fn(),
    ...overrides,
  };

  return { mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo };
}

async function buildApp(
  opts: {
    orchestratorOverrides?: Record<string, unknown>;
    linearPollService?: Record<string, unknown>;
    processRunnerOverrides?: Record<string, unknown>;
    registerOptions?: Record<string, unknown>;
  } = {},
) {
  const { mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo } =
    buildMockOrchestrator(opts.orchestratorOverrides);

  const mockEmitter = {
    on: vi.fn(),
    off: vi.fn(),
    emitChatReply: vi.fn(),
  };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
    ...opts.processRunnerOverrides,
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    opts.linearPollService as never,
    opts.registerOptions as never,
  );

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo, mockEmitter, mockProcessRunner };
}

describe("routes.ts error paths and uncovered branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/runs", () => {
    it("returns the list of runs from findAll, forwarding the state query param", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findAll.mockResolvedValue([makeRun()]);

      const res = await app.inject({ method: "GET", url: "/api/runs?state=Todo" });

      expect(res.statusCode).toBe(200);
      expect(mockRunRepo.findAll).toHaveBeenCalledWith("Todo");
      const body = res.json() as { runs: unknown[] };
      expect(body.runs).toHaveLength(1);
    });
  });

  describe("GET /api/runs/:id", () => {
    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Run not found" });
    });

    it("returns run, artifacts and events on success", async () => {
      const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }]);
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
      expect(body.run.id).toBe("run-1");
      expect(body.artifacts).toEqual([{ id: "a1" }]);
      expect(body.events).toEqual([{ id: "e1" }]);
    });
  });

  describe("GET /api/runs/:id/artifacts", () => {
    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

      expect(res.statusCode).toBe(404);
    });

    it("returns artifacts when run exists", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ artifacts: [{ id: "a1" }] });
    });
  });

  describe("GET /api/runs/:id/events", () => {
    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

      expect(res.statusCode).toBe(404);
    });

    it("returns events when run exists", async () => {
      const { app, mockRunRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ events: [{ id: "e1" }] });
    });
  });

  describe("POST /api/runs/:id/actions/approve-plan", () => {
    it("approves, fires execution in the background, and returns ok + state", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.approvePlan as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRun({ state: RunState.Implementing }),
      );
      (mockOrchestrator.runExecution as ReturnType<typeof vi.fn>).mockResolvedValue(makeRun());

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: { note: "go ahead" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
      expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "go ahead" });
    });

    it("returns 400 when approvePlan rejects", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.approvePlan as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Run is not awaiting plan approval"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Run is not awaiting plan approval" });
    });

    it("logs an error but does not fail the request when background runExecution rejects", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.approvePlan as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRun({ state: RunState.Implementing }),
      );
      (mockOrchestrator.runExecution as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("execution boom"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      // allow the fire-and-forget rejection handler's microtask to run
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe("POST /api/runs/:id/actions/re-review-plan", () => {
    it("returns ok + runId and triggers runManualReReview in the background", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.runManualReReview as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRun(),
      );

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

    it("logs (and does not throw) when the background re-review rejects", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.runManualReReview as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("re-review boom"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe("POST /api/runs/:id/actions/revise-plan", () => {
    it("returns ok + runId and triggers runManualPlanRevision in the background", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.runManualPlanRevision as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRun(),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
        payload: { note: "revise this" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1" });
      expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
        note: "revise this",
      });
    });

    it("logs (and does not throw) when the background revision rejects", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.runManualPlanRevision as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("revision boom"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe("POST /api/runs/:id/actions/approve-review", () => {
    it("returns ok + state on success", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.approveHumanReview as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRun({ state: RunState.Done }),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-review",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, state: RunState.Done });
    });

    it("returns 400 when approveHumanReview rejects", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.approveHumanReview as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("not ready"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-review",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "not ready" });
    });
  });

  describe("POST /api/runs/:id/actions/pause", () => {
    it("returns 404 when run is not found", async () => {
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
      (mockOrchestrator.handleCommand as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("command failed"),
      );

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "command failed" });
    });
  });

  describe("POST /api/runs/:id/actions/resume", () => {
    it("returns 404 when run is not found", async () => {
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
      expect(res.json()).toEqual({ ok: true });
      expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
    });

    it("returns 400 when handleCommand rejects", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      (mockOrchestrator.handleCommand as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("resume failed"),
      );

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "resume failed" });
    });
  });

  describe("POST /api/runs/:id/actions/answer-questions error mapping", () => {
    it("maps a PolicyError to 409", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.answerQuestions as ReturnType<typeof vi.fn>).mockRejectedValue(
        new PolicyError("policy violation"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/answer-questions",
        payload: { answers: [{ questionId: "q1", answer: "a1" }] },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "policy violation" });
    });

    it("maps a ValidationError to 400", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.answerQuestions as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ValidationError("invalid answers"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/answer-questions",
        payload: { answers: [{ questionId: "q1", answer: "a1" }] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid answers" });
    });

    it("maps a plain Error to 400 with its message", async () => {
      const { app, mockOrchestrator } = await buildApp();
      (mockOrchestrator.answerQuestions as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("something else went wrong"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/answer-questions",
        payload: { answers: [{ questionId: "q1", answer: "a1" }] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "something else went wrong" });
    });
  });

  describe("POST /api/runs/:id/actions/retry", () => {
    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for a non-retryable state (e.g. Done)", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("Retry is not supported for state");
      expect(body.error).toContain("Done");
    });

    it.each([
      [RunState.Todo, "retryRun"],
      [RunState.Planning, "runPlanning"],
      [RunState.PlanRevision, "runPlanRevision"],
      [RunState.PlanReview, "runPlanReview"],
      [RunState.Implementing, "runExecution"],
      [RunState.AIReview, "runReview"],
      [RunState.AddressingReview, "runRemediation"],
    ])("triggers %s -> orchestrator.%s() and returns ok+retrying", async (state, methodName) => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state }));
      const method = mockOrchestrator[methodName as keyof typeof mockOrchestrator] as ReturnType<
        typeof vi.fn
      >;
      method.mockResolvedValue(makeRun());

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(method).toHaveBeenCalledWith("run-1");
    });

    it("logs the error without failing the request when the background retry trigger rejects", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
      (mockOrchestrator.retryRun as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("retry boom"),
      );

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe("GET /api/runs/:id/summary", () => {
    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

      expect(res.statusCode).toBe(404);
    });

    it("returns plan: null, planReview: null, review: null, executionReport: null when no artifacts exist", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findLatestByType.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.plan).toBeNull();
      expect(body.planReview).toBeNull();
      expect(body.review).toBeNull();
      expect(body.executionReport).toBeNull();
      expect((body.run as { id: string }).id).toBe("run-1");
    });

    it("builds the full summary payload including risks (string + object forms), steps, and execution report fallback", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());

      mockArtifactRepo.findLatestByType.mockImplementation(
        async (_runId: string, type: string) => {
          if (type === "Plan") {
            return {
              version: 2,
              payloadJson: {
                summary: "Plan summary",
                confidence: 0.75,
                openQuestions: [{ id: "q1", question: "Why?", requiredForExecution: true }],
                steps: [{ id: "s1", title: "Step 1", description: "Do it" }],
                risks: ["plain string risk", { description: "object risk" }, { foo: "bar" }],
                testPlan: "run the tests",
              },
            };
          }
          if (type === "PlanReview") {
            return { version: 1, payloadJson: { verdict: "approved" } };
          }
          if (type === "Review") {
            return { version: 1, payloadJson: { overallVerdict: "approved" } };
          }
          if (type === "ExecutionReport") {
            return {
              version: 3,
              payloadJson: { score: 0.9, scoreRationale: "great" },
            };
          }
          return null;
        },
      );

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, any>;
      expect(body.plan.summary).toBe("Plan summary");
      expect(body.plan.confidence).toBe(0.75);
      expect(body.plan.stepCount).toBe(1);
      expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do it" }]);
      expect(body.plan.risks).toEqual(["plain string risk", "object risk", '{"foo":"bar"}']);
      expect(body.plan.riskCount).toBe(3);
      expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
      expect(body.review).toEqual({ version: 1, payload: { overallVerdict: "approved" } });
      // executionVersion falls back to artifact.version since payload has no executionVersion field
      expect(body.executionReport.executionVersion).toBe(3);
      expect(body.executionReport.score).toBe(0.9);
      expect(body.executionReport.scoreRationale).toBe("great");
    });

    it("handles a plan with no steps/risks arrays gracefully (defaults to empty)", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findLatestByType.mockImplementation(
        async (_runId: string, type: string) => {
          if (type === "Plan") {
            return { version: 1, payloadJson: { summary: "No steps plan" } };
          }
          return null;
        },
      );

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, any>;
      expect(body.plan.stepCount).toBe(0);
      expect(body.plan.steps).toEqual([]);
      expect(body.plan.risks).toEqual([]);
      expect(body.plan.riskCount).toBe(0);
      expect(body.plan.openQuestions).toEqual([]);
    });
  });

  describe("GET /api/processes", () => {
    it("returns all active processes when no runId filter is given", async () => {
      const { app, mockProcessRunner } = await buildApp({
        processRunnerOverrides: {
          getActiveProcesses: vi.fn().mockReturnValue([
            { id: "p1", runId: "run-1" },
            { id: "p2", runId: "run-2" },
          ]),
        },
      });

      const res = await app.inject({ method: "GET", url: "/api/processes" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { processes: unknown[] };
      expect(body.processes).toHaveLength(2);
    });

    it("filters active processes by runId query param", async () => {
      const { app } = await buildApp({
        processRunnerOverrides: {
          getActiveProcesses: vi.fn().mockReturnValue([
            { id: "p1", runId: "run-1" },
            { id: "p2", runId: "run-2" },
          ]),
        },
      });

      const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { processes: { id: string }[] };
      expect(body.processes).toHaveLength(1);
      expect(body.processes[0].id).toBe("p2");
    });
  });

  describe("GET /api/processes/:id/output", () => {
    it("returns 404 when no output is available", async () => {
      const { app } = await buildApp();

      const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Process not found or no output available" });
    });

    it("returns the process output when available", async () => {
      const { app } = await buildApp({
        processRunnerOverrides: {
          getProcessOutput: vi.fn().mockReturnValue("some stdout"),
        },
      });

      const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ processId: "proc-1", output: "some stdout" });
    });
  });

  describe("GET /api/linear/pending", () => {
    it("returns 501 when no linearPollService is configured", async () => {
      const { app } = await buildApp();

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(501);
    });

    it("returns issues on success", async () => {
      const { app } = await buildApp({
        linearPollService: {
          discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-9" }]),
        },
      });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ issues: [{ id: "LIN-9" }] });
    });

    it("returns 500 when discoverPendingIssues rejects", async () => {
      const { app } = await buildApp({
        linearPollService: {
          discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear api down")),
        },
      });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "linear api down" });
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

    it("returns 400 when issueIds is missing", async () => {
      const { app } = await buildApp({
        linearPollService: { startRunsForIssues: vi.fn() },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when issueIds is an empty array", async () => {
      const { app } = await buildApp({
        linearPollService: { startRunsForIssues: vi.fn() },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: [] },
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when issueIds is not an array", async () => {
      const { app } = await buildApp({
        linearPollService: { startRunsForIssues: vi.fn() },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: "LIN-1" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns ok + started/skipped on success", async () => {
      const startRunsForIssues = vi
        .fn()
        .mockResolvedValue({ started: ["LIN-1"], skipped: ["LIN-2"] });
      const { app } = await buildApp({
        linearPollService: { startRunsForIssues },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1", "LIN-2"] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: ["LIN-2"] });
      expect(startRunsForIssues).toHaveBeenCalledWith(["LIN-1", "LIN-2"]);
    });

    it("returns 500 when startRunsForIssues rejects", async () => {
      const { app } = await buildApp({
        linearPollService: {
          startRunsForIssues: vi.fn().mockRejectedValue(new Error("ingest failed")),
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["LIN-1"] },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "ingest failed" });
    });
  });

  describe("GET /api/events/stream (SSE)", () => {
    // This route never calls reply.send() — it keeps the connection open and
    // streams via reply.raw — so app.inject() (which waits for the response
    // to finish) would hang forever. Instead we start a real HTTP listener,
    // read just the headers / first bytes, then close the client socket to
    // trigger the server's request.raw "close" handler.
    async function startRealServer(emitterOverrides: Record<string, unknown> = {}) {
      const mockEmitter = {
        on: vi.fn(),
        off: vi.fn(),
        ...emitterOverrides,
      };
      const { mockOrchestrator } = buildMockOrchestrator();
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
      );
      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      return { app, mockEmitter, port };
    }

    it("writes SSE headers and an initial comment ping, then unsubscribes the listener on close", async () => {
      const { app, mockEmitter, port } = await startRealServer();

      try {
        const result = await new Promise<{
          statusCode: number | undefined;
          headers: http.IncomingHttpHeaders;
          firstChunk: string;
        }>((resolve, reject) => {
          const req = http.get({ host: "127.0.0.1", port, path: "/api/events/stream" }, (res) => {
            let firstChunk = "";
            res.on("data", (chunk: Buffer) => {
              firstChunk += chunk.toString();
              // Once we've received the initial ping, destroy the client
              // socket to simulate the browser disconnecting.
              if (firstChunk.includes(":\n\n")) {
                resolve({ statusCode: res.statusCode, headers: res.headers, firstChunk });
                req.destroy();
              }
            });
          });
          req.on("error", () => {
            // Destroying the request after resolve() can surface a benign
            // ECONNRESET; only reject if we never resolved.
          });
          setTimeout(() => reject(new Error("timed out waiting for SSE response")), 4000);
        });

        expect(result.statusCode).toBe(200);
        expect(result.headers["content-type"]).toBe("text/event-stream");
        expect(result.headers["cache-control"]).toBe("no-cache");
        expect(result.headers["connection"]).toBe("keep-alive");
        expect(result.firstChunk).toContain(":\n\n");

        expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

        // Give the server a moment to observe the socket close and run its
        // cleanup handler.
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", expect.any(Function));
      } finally {
        await app.close();
      }
    }, 10000);

    it("forwards emitted dashboard events to the HTTP response as SSE 'data:' lines", async () => {
      let capturedHandler: ((event: unknown) => void) | undefined;
      const { app, port } = await startRealServer({
        on: vi.fn((_name: string, handler: (event: unknown) => void) => {
          capturedHandler = handler;
        }),
      });

      try {
        const chunks: string[] = [];
        await new Promise<void>((resolve, reject) => {
          const req = http.get({ host: "127.0.0.1", port, path: "/api/events/stream" }, (res) => {
            res.on("data", (chunk: Buffer) => {
              chunks.push(chunk.toString());
              if (chunks.length === 1) {
                // Once connected, simulate the emitter firing a dashboard event.
                expect(capturedHandler).toBeDefined();
                capturedHandler?.({
                  type: "run:state-changed",
                  runId: "run-1",
                  from: "Todo",
                  to: "Planning",
                  timestamp: "2026-01-01T00:00:00.000Z",
                });
              }
              if (chunks.join("").includes("run:state-changed")) {
                req.destroy();
                resolve();
              }
            });
          });
          req.on("error", () => {});
          setTimeout(() => reject(new Error("timed out waiting for forwarded event")), 4000);
        });

        const combined = chunks.join("");
        expect(combined).toContain("data: ");
        expect(combined).toContain("run:state-changed");
        expect(combined).toContain("run-1");
      } finally {
        await app.close();
      }
    }, 10000);
  });
});
