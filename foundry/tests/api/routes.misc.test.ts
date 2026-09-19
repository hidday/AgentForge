import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
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

interface BuildAppOptions {
  run?: ReturnType<typeof makeRun> | null;
  orchestratorOverrides?: Record<string, unknown>;
  processRunnerOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown>;
  eventRepoOverrides?: Record<string, unknown>;
  artifactRepoOverrides?: Record<string, unknown>;
  runRepoOverrides?: Record<string, unknown>;
}

function buildApp(opts: BuildAppOptions = {}) {
  const run = opts.run === undefined ? makeRun() : opts.run;

  const mockRunRepo = {
    findAll: vi.fn().mockResolvedValue([run].filter(Boolean)),
    findById: vi.fn().mockResolvedValue(run),
    ...opts.runRepoOverrides,
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    ...opts.artifactRepoOverrides,
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    ...opts.eventRepoOverrides,
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(undefined),
    approvePlan: vi.fn().mockResolvedValue(run),
    rejectPlan: vi.fn().mockResolvedValue(run),
    runExecution: vi.fn().mockResolvedValue(run),
    runManualReReview: vi.fn().mockResolvedValue(run),
    runManualPlanRevision: vi.fn().mockResolvedValue(run),
    approveHumanReview: vi.fn().mockResolvedValue(run),
    handleCommand: vi.fn().mockResolvedValue(undefined),
    answerQuestions: vi.fn().mockResolvedValue(run),
    retryRun: vi.fn().mockResolvedValue(run),
    runPlanning: vi.fn().mockResolvedValue(run),
    runPlanRevision: vi.fn().mockResolvedValue(run),
    runPlanReview: vi.fn().mockResolvedValue(run),
    runReview: vi.fn().mockResolvedValue(run),
    runRemediation: vi.fn().mockResolvedValue(run),
    ...opts.orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };

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
    {},
  );

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator, mockProcessRunner, mockEmitter, run };
}

describe("GET /api/runs", () => {
  it("returns all runs, forwarding the state querystring filter", async () => {
    const { app, mockRunRepo } = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/runs?state=Planning,PlanReview" });

    expect(response.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Planning,PlanReview");
    expect(JSON.parse(response.body).runs).toHaveLength(1);
  });
});

describe("GET /api/runs/:id", () => {
  it("returns the run with its artifacts and events", async () => {
    const { app } = buildApp({
      artifactRepoOverrides: { findByRunId: vi.fn().mockResolvedValue([{ id: "a1" }]) },
      eventRepoOverrides: { findByRunId: vi.fn().mockResolvedValue([{ id: "e1" }]) },
    });
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "a1" }]);
    expect(body.events).toEqual([{ id: "e1" }]);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "GET", url: "/api/runs/missing" });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns artifacts for the run", async () => {
    const { app } = buildApp({
      artifactRepoOverrides: { findByRunId: vi.fn().mockResolvedValue([{ id: "a1" }]) },
    });
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).artifacts).toEqual([{ id: "a1" }]);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns events for the run", async () => {
    const { app } = buildApp({
      eventRepoOverrides: { findByRunId: vi.fn().mockResolvedValue([{ id: "e1" }]) },
    });
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).events).toEqual([{ id: "e1" }]);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "GET", url: "/api/runs/missing/events" });
    expect(response.statusCode).toBe(404);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, kicks off execution in the background, and returns the new state", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = buildApp({
      orchestratorOverrides: { approvePlan: vi.fn().mockResolvedValue(run), runExecution: vi.fn().mockResolvedValue(run) },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "go" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, state: RunState.Implementing });
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "go" });
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "go" });
  });

  it("returns 400 when approvePlan throws", async () => {
    const { app } = buildApp({
      orchestratorOverrides: { approvePlan: vi.fn().mockRejectedValue(new Error("No plan artifact")) },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("No plan artifact");
  });

  it("logs (does not throw) when the background runExecution rejects", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = buildApp({
      orchestratorOverrides: {
        approvePlan: vi.fn().mockResolvedValue(run),
        runExecution: vi.fn().mockRejectedValue(new Error("executor exploded")),
      },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });
    expect(response.statusCode).toBe(200);
    // Let the background .catch() microtask run.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockOrchestrator.runExecution).toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/reject-plan -- mode validation", () => {
  it("returns 400 for an invalid mode", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("mode must be one of");
  });

  it("passes mode='fresh' through to rejectPlan", async () => {
    const { app, mockOrchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: "start over", mode: "fresh" },
    });
    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", "start over", "api", "fresh");
  });

  it("defaults mode to 'iterate' when omitted", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.inject({ method: "POST", url: "/api/runs/run-1/actions/reject-plan", payload: {} });
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "iterate");
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("kicks off manual re-review in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "double check" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: "double check" });
  });

  it("logs (does not throw) when the background call rejects", async () => {
    const { app, mockOrchestrator } = buildApp({
      orchestratorOverrides: { runManualReReview: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/re-review-plan" });
    expect(response.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("kicks off manual plan revision in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tighten scope" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
  });

  it("logs (does not throw) when the background call rejects", async () => {
    const { app, mockOrchestrator } = buildApp({
      orchestratorOverrides: { runManualPlanRevision: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/revise-plan" });
    expect(response.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("approves human review and returns the new state", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app } = buildApp({ orchestratorOverrides: { approveHumanReview: vi.fn().mockResolvedValue(run) } });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when approveHumanReview throws", async () => {
    const { app } = buildApp({
      orchestratorOverrides: { approveHumanReview: vi.fn().mockRejectedValue(new Error("not ready")) },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("not ready");
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  it("dispatches a pause-ai command by the run's linearIssueId", async () => {
    const { app, mockOrchestrator } = buildApp();
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });
    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app } = buildApp({
      orchestratorOverrides: { handleCommand: vi.fn().mockRejectedValue(new Error("pause failed")) },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("pause failed");
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  it("dispatches a resume-ai command by the run's linearIssueId", async () => {
    const { app, mockOrchestrator } = buildApp();
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });
    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app } = buildApp({
      orchestratorOverrides: { handleCommand: vi.fn().mockRejectedValue(new Error("resume failed")) },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("resume failed");
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
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
  ] as const)("state %s triggers orchestrator.%s in the background", async (state, methodName) => {
    const run = makeRun({ state });
    const { app, mockOrchestrator } = buildApp({ run });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
    expect((mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[methodName]).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 for a non-retryable state", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app } = buildApp({ run });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("Retry is not supported for state");
  });

  it("logs (does not throw) when the background retry call rejects", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockOrchestrator } = buildApp({
      run,
      orchestratorOverrides: { retryRun: vi.fn().mockRejectedValue(new Error("retry boom")) },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });
    expect(response.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockOrchestrator.retryRun).toHaveBeenCalled();
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });
    expect(response.statusCode).toBe(404);
  });

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app } = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
  });

  it("summarizes a full plan (string risks, object risks with description, steps) and an execution report", async () => {
    const plan = {
      summary: "Do the thing",
      confidence: 0.8,
      openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step", description: "desc" }],
      risks: ["plain risk", { description: "object risk" }, { weird: "shape" }],
      testPlan: "run tests",
    };
    const executionReport = { executionVersion: 2, score: 0.9, scoreRationale: "good" };

    const { app } = buildApp({
      artifactRepoOverrides: {
        findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
          if (type === "Plan") return Promise.resolve({ version: 1, payloadJson: plan });
          if (type === "PlanReview") return Promise.resolve({ version: 1, payloadJson: { summary: "ok" } });
          if (type === "Review") return Promise.resolve({ version: 1, payloadJson: { summary: "ok" } });
          if (type === "ExecutionReport") return Promise.resolve({ version: 2, payloadJson: executionReport });
          return Promise.resolve(null);
        }),
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.risks).toEqual(["plain risk", "object risk", '{"weird":"shape"}']);
    expect(body.plan.riskCount).toBe(3);
    expect(body.planReview.version).toBe(1);
    expect(body.review.version).toBe(1);
    expect(body.executionReport.executionVersion).toBe(2);
    expect(body.executionReport.score).toBe(0.9);
  });

  it("defaults steps/openQuestions/risks when the plan payload omits them, and swallows a JSON.stringify failure on a circular risk", async () => {
    const circular: Record<string, unknown> = { self: null };
    circular.self = circular; // JSON.stringify(circular) throws — exercises the catch fallback.
    const plan = {
      summary: "Minimal plan",
      confidence: 0.5,
      // openQuestions and steps intentionally omitted.
      risks: [circular],
      testPlan: "run tests",
    };

    const { app } = buildApp({
      artifactRepoOverrides: {
        findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
          if (type === "Plan") return Promise.resolve({ version: 1, payloadJson: plan });
          return Promise.resolve(null);
        }),
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
    // JSON.stringify on a circular object throws, so the catch path falls back to String(r).
    expect(body.plan.risks).toEqual(["[object Object]"]);
  });

  it("falls back to the artifact version when executionReport payload has no executionVersion", async () => {
    const { app } = buildApp({
      artifactRepoOverrides: {
        findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
          if (type === "ExecutionReport") return Promise.resolve({ version: 5, payloadJson: null });
          return Promise.resolve(null);
        }),
      },
    });
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = JSON.parse(response.body);
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBeUndefined();
  });
});

describe("POST /api/runs/:id/actions/request-human -- run lookup", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
    const { app } = buildApp({ processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) } });
    const response = await app.inject({ method: "GET", url: "/api/processes" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).processes).toHaveLength(2);
  });

  it("filters active processes by runId", async () => {
    const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
    const { app } = buildApp({ processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) } });
    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });
    const body = JSON.parse(response.body);
    expect(body.processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns the process output when found", async () => {
    const { app } = buildApp({ processRunnerOverrides: { getProcessOutput: vi.fn().mockReturnValue("log output") } });
    const response = await app.inject({ method: "GET", url: "/api/processes/p1/output" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ processId: "p1", output: "log output" });
  });

  it("returns 404 when the process/output is not found", async () => {
    const { app } = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/processes/missing/output" });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/linear/pending", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(response.statusCode).toBe(501);
  });

  it("returns discovered issues on success", async () => {
    const { app } = buildApp({
      linearPollService: { discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-9" }]) },
    });
    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).issues).toEqual([{ id: "LIN-9" }]);
  });

  it("returns 500 when discoverPendingIssues throws", async () => {
    const { app } = buildApp({
      linearPollService: { discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear down")) },
    });
    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe("linear down");
  });
});

describe("POST /api/linear/ingest", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = buildApp();
    const response = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: { issueIds: ["LIN-1"] } });
    expect(response.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const { app } = buildApp({ linearPollService: { startRunsForIssues: vi.fn() } });
    const response = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("starts runs for the given issueIds on success", async () => {
    const { app } = buildApp({
      linearPollService: { startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"] }) },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, started: ["LIN-1"] });
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const { app } = buildApp({
      linearPollService: { startRunsForIssues: vi.fn().mockRejectedValue(new Error("ingest failed")) },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe("ingest failed");
  });
});

describe("GET /api/events/stream (SSE)", () => {
  // Fastify's inject() waits for the response to end, but this route intentionally
  // never ends the response (it streams indefinitely). We capture the registered
  // handler directly via a minimal fake FastifyInstance instead of going through
  // a real HTTP round trip, so we can exercise its logic without hanging the test.
  function buildFakeAppAndCaptureStreamHandler() {
    type Handler = (request: unknown, reply: unknown) => void;
    const routes: Record<string, Handler> = {};
    const fakeApp = {
      get: (path: string, handler: Handler) => {
        routes[`GET ${path}`] = handler;
      },
      post: (_path: string, _handler: Handler) => {},
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    };

    const mockRunRepo = { findAll: vi.fn(), findById: vi.fn() };
    const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
    const mockEventRepo = { findByRunId: vi.fn(), create: vi.fn() };
    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => mockArtifactRepo,
      getEventRepo: () => mockEventRepo,
      getAgentSkillRepo: () => undefined,
    };
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      fakeApp as never,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
      undefined,
      {},
    );

    return { handler: routes["GET /api/events/stream"], mockEmitter };
  }

  it("writes SSE headers, an initial comment, registers a dashboard listener, and cleans up on close", () => {
    vi.useFakeTimers();
    try {
      const { handler, mockEmitter } = buildFakeAppAndCaptureStreamHandler();

      const rawWrite = vi.fn();
      const rawWriteHead = vi.fn();
      let closeHandler: (() => void) | undefined;
      const fakeRequest = { raw: { on: vi.fn((event: string, cb: () => void) => { if (event === "close") closeHandler = cb; }) } };
      const fakeReply = { raw: { writeHead: rawWriteHead, write: rawWrite } };

      handler(fakeRequest, fakeReply);

      expect(rawWriteHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/event-stream" }));
      expect(rawWrite).toHaveBeenCalledWith(":\n\n");
      expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

      // Simulate a dashboard event being emitted: the registered handler should
      // write it as an SSE `data:` line.
      const dashboardHandler = mockEmitter.on.mock.calls[0][1] as (event: unknown) => void;
      dashboardHandler({ type: "run:created", runId: "run-1" });
      expect(rawWrite).toHaveBeenCalledWith(expect.stringContaining('"type":"run:created"'));

      // Advance past the heartbeat interval.
      rawWrite.mockClear();
      vi.advanceTimersByTime(15_000);
      expect(rawWrite).toHaveBeenCalledWith(":\n\n");

      // Simulate the client disconnecting: the heartbeat is cleared and the
      // listener is removed.
      expect(closeHandler).toBeDefined();
      closeHandler!();
      expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

      rawWrite.mockClear();
      vi.advanceTimersByTime(30_000);
      expect(rawWrite).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
