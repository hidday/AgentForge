import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: null,
    linearIssueTitle: "Add auth middleware",
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

function makeArtifact(type: string, payloadJson: unknown, version = 1) {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type,
    version,
    payloadJson,
    rawText: "",
    createdAt: new Date(),
  };
}

async function buildApp(opts: {
  orchestratorOverrides?: Record<string, unknown>;
  withLinearPoll?: boolean;
  linearPollOverrides?: Record<string, unknown>;
  registerOptions?: Record<string, unknown>;
} = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn(), create: vi.fn() };

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
    ...opts.orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockLinearPollService = opts.withLinearPoll
    ? {
        discoverPendingIssues: vi.fn().mockResolvedValue([]),
        startRunsForIssues: vi.fn().mockResolvedValue({ started: [], skipped: [] }),
        ...opts.linearPollOverrides,
      }
    : undefined;

  const routeHandlers: Record<string, (request: unknown, reply: unknown) => unknown> = {};

  const app = Fastify({ logger: false });
  app.addHook("onRoute", (routeOptions) => {
    routeHandlers[`${routeOptions.method}:${routeOptions.url}`] =
      routeOptions.handler as (request: unknown, reply: unknown) => unknown;
  });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    mockLinearPollService as never,
    opts.registerOptions,
  );

  await app.ready();
  return {
    app,
    mockRunRepo,
    mockArtifactRepo,
    mockEventRepo,
    mockOrchestrator,
    mockEmitter,
    mockProcessRunner,
    mockLinearPollService,
    routeHandlers,
  };
}

describe("GET /api/runs", () => {
  it("returns all runs, forwarding the state query param", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([makeRun()]);

    const response = await app.inject({ method: "GET", url: "/api/runs?state=Todo" });

    expect(response.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Todo");
    const body = JSON.parse(response.body) as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
  });

  it("passes undefined state when no query param is given", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/api/runs" });

    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
  });
});

describe("GET /api/runs/:id", () => {
  it("returns run, artifacts and events on success", async () => {
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    const run = makeRun();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([makeArtifact("Plan", {})]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { run: { id: string }; artifacts: unknown[]; events: unknown[] };
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toHaveLength(1);
    expect(body.events).toHaveLength(1);
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
  it("returns artifacts for an existing run", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([makeArtifact("Plan", {})]);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { artifacts: unknown[] };
    expect(body.artifacts).toHaveLength(1);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns events for an existing run", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, fires runExecution in the background, and returns the new state", async () => {
    const { app, mockOrchestrator } = await buildApp();
    const approved = makeRun({ state: RunState.Implementing });
    mockOrchestrator.approvePlan.mockResolvedValue(approved);
    mockOrchestrator.runExecution.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "  looks good  " },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("logs but does not fail the request when the background runExecution rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns 400 when approvePlan throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Plan not awaiting approval"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Plan not awaiting approval" });
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("triggers runManualReReview in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: "please re-check" });
  });

  it("does not fail the request when the background call rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("triggers runManualPlanRevision in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tighten scope" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "tighten scope",
    });
  });

  it("does not fail the request when the background call rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
    });

    expect(response.statusCode).toBe(200);
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
    expect(JSON.parse(response.body)).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when approveHumanReview throws", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("Not awaiting human review"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Not awaiting human review" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  it("sends a pause-ai command for the run's Linear issue", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ linearIssueId: "LIN-99" }));
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-99", { type: "pause-ai" });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Cannot pause"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Cannot pause" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  it("sends a resume-ai command for the run's Linear issue", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ linearIssueId: "LIN-99" }));
    mockOrchestrator.handleCommand.mockResolvedValue(undefined);

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-99", { type: "resume-ai" });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("Cannot resume"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Cannot resume" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for a state that is not retryable", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toContain("Retry is not supported");
  });

  const retryCases: [string, string][] = [
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ];

  it.each(retryCases)(
    "triggers %s -> orchestrator.%s() for a retryable state and returns retrying:true",
    async (state, method) => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state }));
      (mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[method].mockResolvedValue(
        undefined,
      );

      const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        ok: boolean;
        runId: string;
        state: string;
        retrying: boolean;
      };
      expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(
        (mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[method],
      ).toHaveBeenCalledWith("run-1");
    },
  );

  it("does not fail the request when the background retry trigger rejects", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue(new Error("boom"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(200);
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(response.statusCode).toBe(404);
  });

  it("returns nulls for every artifact section when no artifacts exist", async () => {
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
    expect((body.run as { id: string }).id).toBe("run-1");
  });

  it("maps plan risks given as plain strings, objects with description, and unknown shapes", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    const planPayload = {
      summary: "Add auth",
      confidence: 0.8,
      openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
      risks: ["Simple risk string", { description: "Object risk" }, { weird: "shape" }, 42],
      testPlan: "Run unit tests",
    };
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", planPayload, 3));
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      plan: { risks: string[]; riskCount: number; stepCount: number };
    };
    expect(body.plan.riskCount).toBe(4);
    expect(body.plan.risks[0]).toBe("Simple risk string");
    expect(body.plan.risks[1]).toBe("Object risk");
    expect(body.plan.risks[3]).toBe("42");
    expect(body.plan.stepCount).toBe(1);
  });

  it("includes planReview, review and executionReport sections when those artifacts exist", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", { verdict: "approved" }, 1));
      if (type === "Review") return Promise.resolve(makeArtifact("Review", { verdict: "pass" }, 2));
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact("ExecutionReport", { executionVersion: 5, score: 0.9, scoreRationale: "solid" }, 2),
        );
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
      executionReport: { executionVersion: number; score: number; scoreRationale: string };
    };
    expect(body.planReview.payload).toEqual({ verdict: "approved" });
    expect(body.review.payload).toEqual({ verdict: "pass" });
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBe(0.9);
  });

  it("falls back executionVersion to the artifact version when payload omits it", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact("ExecutionReport", null, 7));
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = JSON.parse(response.body) as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(7);
  });
});

describe("GET /api/processes", () => {
  it("returns all processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const response = await app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { processes: unknown[] };
    expect(body.processes).toHaveLength(2);
  });

  it("filters processes by runId query param", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    const body = JSON.parse(response.body) as { processes: { id: string }[] };
    expect(body.processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns the process output when available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("stdout contents");

    const response = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ processId: "p1", output: "stdout contents" });
  });

  it("returns 404 when there is no output for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const response = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/linear/pending", () => {
  it("returns 501 when no LinearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPoll: false });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(501);
  });

  it("returns pending issues on success", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPoll: true });
    mockLinearPollService!.discoverPendingIssues.mockResolvedValue([{ id: "LIN-5" }]);

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ issues: [{ id: "LIN-5" }] });
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPoll: true });
    mockLinearPollService!.discoverPendingIssues.mockRejectedValue(new Error("Linear API down"));

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: "Linear API down" });
  });
});

describe("POST /api/linear/ingest", () => {
  it("returns 501 when no LinearPollService is configured", async () => {
    const { app } = await buildApp({ withLinearPoll: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const { app } = await buildApp({ withLinearPoll: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("starts runs for the given issue ids on success", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPoll: true });
    mockLinearPollService!.startRunsForIssues.mockResolvedValue({
      started: ["LIN-1"],
      skipped: ["LIN-2"],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1", "LIN-2"] },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      started: ["LIN-1"],
      skipped: ["LIN-2"],
    });
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const { app, mockLinearPollService } = await buildApp({ withLinearPoll: true });
    mockLinearPollService!.startRunsForIssues.mockRejectedValue(new Error("DB unavailable"));

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: "DB unavailable" });
  });
});

describe("GET /api/events/stream", () => {
  // This route never ends its response (it's a long-lived SSE connection), so
  // app.inject() would hang waiting for completion. We capture the raw route
  // handler via the onRoute hook instead and drive it with fake request/reply
  // objects that mimic only what the handler actually touches.
  function makeFakeReqReply() {
    const closeEmitter = new EventTarget();
    const request = {
      raw: {
        on: (event: string, cb: () => void) => {
          if (event === "close") closeEmitter.addEventListener("close", cb);
        },
      },
    };
    const reply = {
      raw: {
        writeHead: vi.fn(),
        write: vi.fn(),
      },
    };
    return {
      request,
      reply,
      triggerClose: () => closeEmitter.dispatchEvent(new Event("close")),
    };
  }

  it("writes SSE headers and registers a dashboard listener", async () => {
    const { routeHandlers, mockEmitter } = await buildApp();
    const handler = routeHandlers["GET:/api/events/stream"];
    const { request, reply } = makeFakeReqReply();

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }),
    );
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("forwards emitted dashboard events to the client as SSE data frames", async () => {
    const { routeHandlers, mockEmitter } = await buildApp();
    const handler = routeHandlers["GET:/api/events/stream"];
    const { request, reply } = makeFakeReqReply();

    handler(request, reply);

    const dashboardHandler = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard")?.[1] as
      | ((event: unknown) => void)
      | undefined;
    expect(dashboardHandler).toBeDefined();

    dashboardHandler!({ type: "run:updated", runId: "run-1" });

    expect(reply.raw.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ type: "run:updated", runId: "run-1" })}\n\n`,
    );
  });

  it("sends periodic heartbeats and cleans up the listener + timer when the connection closes", async () => {
    vi.useFakeTimers();
    try {
      const { routeHandlers, mockEmitter } = await buildApp();
      const handler = routeHandlers["GET:/api/events/stream"];
      const { request, reply, triggerClose } = makeFakeReqReply();

      handler(request, reply);
      const writeCallsBeforeHeartbeat = reply.raw.write.mock.calls.length;

      vi.advanceTimersByTime(15_000);
      expect(reply.raw.write.mock.calls.length).toBeGreaterThan(writeCallsBeforeHeartbeat);

      const dashboardHandler = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard")?.[1];
      triggerClose();
      expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

      const writeCallsAfterClose = reply.raw.write.mock.calls.length;
      vi.advanceTimersByTime(30_000);
      // The heartbeat interval was cleared on close, so no further writes occur.
      expect(reply.raw.write.mock.calls.length).toBe(writeCallsAfterClose);
    } finally {
      vi.useRealTimers();
    }
  });
});
