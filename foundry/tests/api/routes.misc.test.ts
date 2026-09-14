import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

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
    workingDirectory: "/tmp/not-checked-by-these-routes",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

interface BuildOpts {
  linearPollService?: Record<string, unknown> | undefined;
  routeOptions?: Record<string, unknown>;
}

function buildApp(opts: BuildOpts = {}) {
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

  const mockEmitter = {
    on: vi.fn(),
    off: vi.fn(),
    emitChatReply: vi.fn(),
  };

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
    opts.linearPollService as never,
    opts.routeOptions,
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

describe("GET /api/runs", () => {
  it("returns { runs } from findAll, forwarding the state query param", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    const runs = [makeRun()];
    mockRunRepo.findAll.mockResolvedValue(runs);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Todo" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Todo");
    expect(res.json()).toEqual({ runs: JSON.parse(JSON.stringify(runs)) });
  });

  it("passes undefined state when no query param given", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    mockRunRepo.findAll.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/api/runs" });

    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
  });
});

describe("GET /api/runs/:id", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns { run, artifacts, events } when found", async () => {
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = buildApp();
    await app.ready();
    const run = makeRun();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "a1" }]);
    expect(body.events).toEqual([{ id: "e1" }]);
    expect(mockArtifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(mockEventRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });
    expect(res.statusCode).toBe(404);
  });

  it("returns { artifacts } when the run exists", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1", type: "Plan" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ artifacts: [{ id: "a1", type: "Plan" }] });
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });
    expect(res.statusCode).toBe(404);
  });

  it("returns { events } when the run exists", async () => {
    const { app, mockRunRepo, mockEventRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1", eventType: "PLAN_CREATED" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [{ id: "e1", eventType: "PLAN_CREATED" }] });
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, kicks off execution, and returns { ok, state }", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
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

  it("treats a blank note as no note (sanitizeNote -> undefined)", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun());
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });

  it("returns 400 with the error message when approvePlan throws", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("wrong state for approval"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "wrong state for approval" });
  });

  it("logs (does not crash the response) when the background runExecution rejects", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    const errorSpy = vi.spyOn(app.log, "error").mockImplementation(() => {});
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun());
    mockOrchestrator.runExecution.mockRejectedValue(new Error("execution boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "execution boom" }),
        "Execution failed",
      );
    });
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("triggers runManualReReview and returns { ok, runId }", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please recheck" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please recheck",
    });
  });

  it("logs when the background call rejects", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    const errorSpy = vi.spyOn(app.log, "error").mockImplementation(() => {});
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("re-review boom"));

    await app.inject({ method: "POST", url: "/api/runs/run-1/actions/re-review-plan", payload: {} });

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "re-review boom" }),
        "Manual re-review failed",
      );
    });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("triggers runManualPlanRevision and returns { ok, runId }", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

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
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("approves human review and returns { ok, state }", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.approveHumanReview.mockResolvedValue(makeRun({ state: RunState.Done }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when approveHumanReview throws", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("not ready"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "not ready" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });
    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with pause-ai and returns { ok: true }", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun({ linearIssueId: "LIN-9" }));
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-9", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot pause" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });
    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with resume-ai and returns { ok: true }", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun({ linearIssueId: "LIN-9" }));
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-9", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 listing retryable states when the run's state is not retryable", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('Retry is not supported for state "Done"');
    expect(body.error).toContain("Todo");
    expect(body.error).toContain("Implementing");
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

  it.each(retryMatrix)("state %s triggers orchestrator.%s and returns retrying:true", async (state, method) => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state }));
    (mockOrchestrator as unknown as Record<string, ReturnType<typeof vi.fn>>)[method].mockResolvedValue(
      undefined,
    );

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
    expect(
      (mockOrchestrator as unknown as Record<string, ReturnType<typeof vi.fn>>)[method],
    ).toHaveBeenCalledWith("run-1");
  });

  it("logs when the background retry trigger rejects", async () => {
    const { app, mockRunRepo, mockOrchestrator } = buildApp();
    await app.ready();
    const errorSpy = vi.spyOn(app.log, "error").mockImplementation(() => {});
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry boom"));

    await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "retry boom" }),
        "Retry stage failed",
      );
    });
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });
    expect(res.statusCode).toBe(404);
  });

  it("returns null plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
  });

  it("summarizes a full plan with string and object risks, steps and open questions", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return {
          version: 2,
          payloadJson: {
            summary: "Do the thing",
            confidence: 0.8,
            openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Step 1", description: "Do step 1", extra: "ignored" }],
            risks: ["plain risk", { description: "object risk" }, { weird: "shape" }, 42],
            testPlan: "run tests",
          },
        };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json();

    expect(body.plan).toMatchObject({
      version: 2,
      summary: "Do the thing",
      confidence: 0.8,
      stepCount: 1,
      riskCount: 4,
    });
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do step 1" }]);
    expect(body.plan.risks).toEqual([
      "plain risk",
      "object risk",
      JSON.stringify({ weird: "shape" }),
      "42",
    ]);
  });

  it("includes planReview and review payloads when present", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "PlanReview") return { version: 1, payloadJson: { verdict: "approved" } };
      if (type === "Review") return { version: 3, payloadJson: { verdict: "changes_requested" } };
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json();

    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 3, payload: { verdict: "changes_requested" } });
  });

  it("derives executionReport fields, falling back to artifact.version when executionVersion is absent", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = buildApp();
    await app.ready();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return { version: 5, payloadJson: { score: 0.9, scoreRationale: "solid" } };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json();

    expect(body.executionReport).toMatchObject({
      version: 5,
      executionVersion: 5,
      score: 0.9,
      scoreRationale: "solid",
    });
  });
});

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = buildApp();
    await app.ready();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes" });
    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toHaveLength(2);
  });

  it("filters by runId when provided", async () => {
    const { app, mockProcessRunner } = buildApp();
    await app.ready();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });
    expect(res.json().processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns 404 when no output is available", async () => {
    const { app, mockProcessRunner } = buildApp();
    await app.ready();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });
    expect(res.statusCode).toBe(404);
  });

  it("returns { processId, output } when output exists", async () => {
    const { app, mockProcessRunner } = buildApp();
    await app.ready();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

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

  it("returns { issues } on success", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-1" }]),
      startRunsForIssues: vi.fn(),
    };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "LIN-1" }] });
  });

  it("returns 500 with the error message when discoverPendingIssues throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear api down")),
      startRunsForIssues: vi.fn(),
    };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "linear api down" });
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
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn(),
    };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
    expect(res.statusCode).toBe(400);

    const res2 = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });
    expect(res2.statusCode).toBe(400);
  });

  it("returns { ok: true, ...result } on success", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockResolvedValue({ started: 2, skipped: 1 }),
    };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1", "LIN-2"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: 2, skipped: 1 });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1", "LIN-2"]);
  });

  it("returns 500 with the error message when startRunsForIssues throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("ingest failed")),
    };
    const { app } = buildApp({ linearPollService });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ingest failed" });
  });
});

// sanity check that RunEvent import compiles against real event names used elsewhere
describe("module sanity", () => {
  it("RunEvent.HUMAN_REQUESTED constant is stable", () => {
    expect(RunEvent.HUMAN_REQUESTED).toBe("HUMAN_REQUESTED");
  });
});

describe("POST /api/runs/:id/actions/revise-plan — background failure logging", () => {
  it("logs when runManualPlanRevision rejects", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();
    const errorSpy = vi.spyOn(app.log, "error").mockImplementation(() => {});
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("revise boom"));

    await app.inject({ method: "POST", url: "/api/runs/run-1/actions/revise-plan", payload: {} });

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "revise boom" }),
        "Manual plan revision failed",
      );
    });
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
