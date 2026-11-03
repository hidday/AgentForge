import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

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
    prNumber: 7,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 3,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
    ...overrides,
  };
}

function buildApp(overrides: {
  runRepo?: Record<string, unknown>;
  artifactRepo?: Record<string, unknown>;
  eventRepo?: Record<string, unknown>;
  orchestrator?: Record<string, unknown>;
  processRunner?: Record<string, unknown>;
  linearPollService?: Record<string, unknown>;
} = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn().mockResolvedValue([]), ...overrides.runRepo };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    ...overrides.artifactRepo,
  };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn(), ...overrides.eventRepo };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(undefined),
    getLinearClient: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn().mockResolvedValue(undefined),
    answerQuestions: vi.fn(),
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
    ...overrides.orchestrator,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
    ...overrides.processRunner,
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    overrides.linearPollService as never,
    {},
  );

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator, mockProcessRunner };
}

describe("GET /api/runs", () => {
  it("returns all runs, forwarding the state querystring filter", async () => {
    const runs = [makeRun()];
    const { app, mockRunRepo } = buildApp({ runRepo: { findAll: vi.fn().mockResolvedValue(runs) } });

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Todo,Planning" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Todo,Planning");
    expect(res.json().runs).toHaveLength(1);
  });

  it("returns all runs with no filter when no querystring is given", async () => {
    const { app, mockRunRepo } = buildApp();

    await app.inject({ method: "GET", url: "/api/runs" });

    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
  });
});

describe("GET /api/runs/:id", () => {
  it("returns the run with its artifacts and events", async () => {
    const run = makeRun();
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepo: { findByRunId: vi.fn().mockResolvedValue([{ id: "a1" }]) },
      eventRepo: { findByRunId: vi.fn().mockResolvedValue([{ id: "e1" }]) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "a1" }]);
    expect(body.events).toEqual([{ id: "e1" }]);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(null) } });

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Run not found");
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns the run's artifacts", async () => {
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      artifactRepo: { findByRunId: vi.fn().mockResolvedValue([{ id: "a1" }, { id: "a2" }]) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json().artifacts).toHaveLength(2);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(null) } });

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns the run's events", async () => {
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      eventRepo: { findByRunId: vi.fn().mockResolvedValue([{ id: "e1" }]) },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([{ id: "e1" }]);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(null) } });

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, kicks off execution in the background, and returns the new state", async () => {
    const approvedRun = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = buildApp({
      orchestrator: { approvePlan: vi.fn().mockResolvedValue(approvedRun) },
    });

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

  it("returns 400 when approvePlan rejects (e.g. a policy violation)", async () => {
    const { app } = buildApp({
      orchestrator: { approvePlan: vi.fn().mockRejectedValue(new Error("not allowed")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not allowed");
  });

  it("logs but does not fail the request when the background runExecution rejects", async () => {
    const approvedRun = makeRun({ state: RunState.Implementing });
    const { app } = buildApp({
      orchestrator: {
        approvePlan: vi.fn().mockResolvedValue(approvedRun),
        runExecution: vi.fn().mockRejectedValue(new Error("boom")),
      },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan", payload: {} });

    expect(res.statusCode).toBe(200);
    // allow the fire-and-forget rejection's .catch() handler to run
    await new Promise((r) => setTimeout(r, 10));
  });

  it("still logs cleanly when the background runExecution rejects with a non-Error value", async () => {
    const approvedRun = makeRun({ state: RunState.Implementing });
    const { app } = buildApp({
      orchestrator: {
        approvePlan: vi.fn().mockResolvedValue(approvedRun),
        runExecution: vi.fn().mockRejectedValue("non-error-rejection"),
      },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan", payload: {} });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });

  it("returns 400 with a stringified error when approvePlan rejects with a non-Error value", async () => {
    const { app } = buildApp({ orchestrator: { approvePlan: vi.fn().mockRejectedValue("plain string failure") } });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("plain string failure");
  });

  it("treats a whitespace-only note as no note provided (sanitizeNote)", async () => {
    const approvedRun = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = buildApp({
      orchestrator: { approvePlan: vi.fn().mockResolvedValue(approvedRun) },
    });

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("triggers a manual re-review in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: "please re-check" });
  });

  it("returns 400 when runManualReReview throws synchronously inside the try block", async () => {
    const { app } = buildApp({
      orchestrator: {
        runManualReReview: vi.fn().mockImplementation(() => {
          throw new Error("sync failure");
        }),
      },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/re-review-plan", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("sync failure");
  });

  it("logs via app.log.error when the background runManualReReview promise rejects", async () => {
    const { app } = buildApp({
      orchestrator: { runManualReReview: vi.fn().mockRejectedValue(new Error("async failure")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/re-review-plan", payload: {} });

    expect(res.statusCode).toBe(200);
    // allow the fire-and-forget rejection's .catch() handler to run
    await new Promise((r) => setTimeout(r, 10));
  });

  it("logs cleanly when the background runManualReReview promise rejects with a non-Error value", async () => {
    const { app } = buildApp({
      orchestrator: { runManualReReview: vi.fn().mockRejectedValue("non-error") },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/re-review-plan", payload: {} });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });

  it("returns 400 with a stringified error when runManualReReview throws a non-Error value synchronously", async () => {
    const { app } = buildApp({
      orchestrator: {
        runManualReReview: vi.fn().mockImplementation(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "sync non-error";
        }),
      },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/re-review-plan", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("sync non-error");
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("triggers a manual plan revision in the background and returns immediately", async () => {
    const { app, mockOrchestrator } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tweak step 2" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", { note: "tweak step 2" });
  });

  it("returns 400 when runManualPlanRevision throws synchronously", async () => {
    const { app } = buildApp({
      orchestrator: {
        runManualPlanRevision: vi.fn().mockImplementation(() => {
          throw new Error("sync failure");
        }),
      },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/revise-plan", payload: {} });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with a stringified error when runManualPlanRevision throws a non-Error value synchronously", async () => {
    const { app } = buildApp({
      orchestrator: {
        runManualPlanRevision: vi.fn().mockImplementation(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "sync non-error";
        }),
      },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/revise-plan", payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("sync non-error");
  });

  it("logs via app.log.error when the background runManualPlanRevision promise rejects", async () => {
    const { app } = buildApp({
      orchestrator: { runManualPlanRevision: vi.fn().mockRejectedValue(new Error("async failure")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/revise-plan", payload: {} });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });

  it("logs cleanly when the background runManualPlanRevision promise rejects with a non-Error value", async () => {
    const { app } = buildApp({
      orchestrator: { runManualPlanRevision: vi.fn().mockRejectedValue("non-error") },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/revise-plan", payload: {} });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("approves the human review and returns the new state", async () => {
    const { app, mockOrchestrator } = buildApp({
      orchestrator: { approveHumanReview: vi.fn().mockResolvedValue(makeRun({ state: RunState.Done })) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 when approveHumanReview rejects", async () => {
    const { app } = buildApp({
      orchestrator: { approveHumanReview: vi.fn().mockRejectedValue(new Error("nope")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("nope");
  });

  it("returns 400 with a stringified error when approveHumanReview rejects with a non-Error value", async () => {
    const { app } = buildApp({
      orchestrator: { approveHumanReview: vi.fn().mockRejectedValue("non-error") },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("non-error");
  });
});

describe("POST /api/runs/:id/actions/pause and /resume", () => {
  it("pause: looks up the run, sends pause-ai, and returns ok", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(run) } });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, { type: "pause-ai" });
  });

  it("pause: returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(null) } });

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(res.statusCode).toBe(404);
  });

  it("pause: returns 400 when handleCommand rejects", async () => {
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      orchestrator: { handleCommand: vi.fn().mockRejectedValue(new Error("broken")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
  });

  it("pause: returns 400 with a stringified error when handleCommand rejects with a non-Error value", async () => {
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      orchestrator: { handleCommand: vi.fn().mockRejectedValue("non-error") },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("non-error");
  });

  it("resume: looks up the run, sends resume-ai, and returns ok", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(run) } });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, { type: "resume-ai" });
  });

  it("resume: returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(null) } });

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(res.statusCode).toBe(404);
  });

  it("resume: returns 400 when handleCommand rejects", async () => {
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      orchestrator: { handleCommand: vi.fn().mockRejectedValue(new Error("broken")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("broken");
  });

  it("resume: returns 400 with a stringified error when handleCommand rejects with a non-Error value", async () => {
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      orchestrator: { handleCommand: vi.fn().mockRejectedValue("non-error") },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("non-error");
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(null) } });

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
  ] as const)("retries from state %s by firing orchestrator.%s in the background", async (state, method) => {
    const run = makeRun({ state });
    const { app, mockOrchestrator } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(run) } });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
    expect((mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[method]).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 for a state with no retry mapping", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(run) } });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Retry is not supported for state");
  });

  it("logs but does not fail the request when the background retry trigger rejects", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      orchestrator: { retryRun: vi.fn().mockRejectedValue(new Error("retry blew up")) },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });

  it("logs cleanly when the background retry trigger rejects with a non-Error value", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(run) },
      orchestrator: { retryRun: vi.fn().mockRejectedValue("non-error") },
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(null) } });

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns nulls for plan/planReview/review/executionReport when no artifacts exist", async () => {
    const { app } = buildApp({ runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) } });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
  });

  it("summarizes a plan with string and object risks, steps, and open questions", async () => {
    const planArtifact = {
      version: 2,
      payloadJson: {
        summary: "Do the thing",
        confidence: 0.8,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
        steps: [{ id: "s1", title: "Step 1", description: "desc" }],
        risks: ["simple string risk", { description: "object risk" }, { weird: "shape" }, 42],
        testPlan: "run tests",
      },
    };
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      artifactRepo: {
        findByRunId: vi.fn().mockResolvedValue([]),
        findLatestByType: vi.fn().mockImplementation((_id, type) =>
          Promise.resolve(type === "Plan" ? planArtifact : null),
        ),
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.plan.summary).toBe("Do the thing");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.risks).toEqual(["simple string risk", "object risk", '{"weird":"shape"}', "42"]);
    expect(body.plan.riskCount).toBe(4);
  });

  it("falls back to String(r) when JSON.stringify throws on a risk value", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const planArtifact = {
      version: 1,
      payloadJson: { summary: "x", risks: [circular] },
    };
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      artifactRepo: {
        findByRunId: vi.fn().mockResolvedValue([]),
        findLatestByType: vi.fn().mockImplementation((_id, type) =>
          Promise.resolve(type === "Plan" ? planArtifact : null),
        ),
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    expect(res.json().plan.risks[0]).toBe(String(circular));
  });

  it("summarizes planReview, review, and executionReport artifacts when present", async () => {
    const byType: Record<string, unknown> = {
      PlanReview: { version: 1, payloadJson: { verdict: "approved" } },
      Review: { version: 2, payloadJson: { overallVerdict: "approved" } },
      ExecutionReport: { version: 3, payloadJson: { executionVersion: 3, score: 0.9, scoreRationale: "good" } },
    };
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      artifactRepo: {
        findByRunId: vi.fn().mockResolvedValue([]),
        findLatestByType: vi.fn().mockImplementation((_id, type) => Promise.resolve(byType[type] ?? null)),
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 2, payload: { overallVerdict: "approved" } });
    expect(body.executionReport).toMatchObject({ version: 3, executionVersion: 3, score: 0.9 });
  });

  it("falls back to the artifact version as executionVersion when the payload omits it", async () => {
    const byType: Record<string, unknown> = {
      ExecutionReport: { version: 5, payloadJson: {} },
    };
    const { app } = buildApp({
      runRepo: { findById: vi.fn().mockResolvedValue(makeRun()) },
      artifactRepo: {
        findByRunId: vi.fn().mockResolvedValue([]),
        findLatestByType: vi.fn().mockImplementation((_id, type) => Promise.resolve(byType[type] ?? null)),
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.json().executionReport.executionVersion).toBe(5);
  });
});

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
    const { app } = buildApp({ processRunner: { getActiveProcesses: vi.fn().mockReturnValue(processes) } });

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.json().processes).toHaveLength(2);
  });

  it("filters active processes by runId when given", async () => {
    const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
    const { app } = buildApp({ processRunner: { getActiveProcesses: vi.fn().mockReturnValue(processes) } });

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.json().processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns the process output when found", async () => {
    const { app } = buildApp({ processRunner: { getProcessOutput: vi.fn().mockReturnValue("some output") } });

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some output" });
  });

  it("returns 404 when there is no output for the process id", async () => {
    const { app } = buildApp({ processRunner: { getProcessOutput: vi.fn().mockReturnValue(null) } });

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/linear/pending", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = buildApp();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
  });

  it("returns discovered issues when configured", async () => {
    const { app } = buildApp({
      linearPollService: { discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-1" }]) },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json().issues).toEqual([{ id: "LIN-1" }]);
  });

  it("returns 500 when discovery throws", async () => {
    const { app } = buildApp({
      linearPollService: { discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear down")) },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("linear down");
  });

  it("returns 500 with a stringified error when discovery rejects with a non-Error value", async () => {
    const { app } = buildApp({
      linearPollService: { discoverPendingIssues: vi.fn().mockRejectedValue("non-error") },
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("non-error");
  });
});

describe("POST /api/linear/ingest", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = buildApp();

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: { issueIds: ["x"] } });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const { app } = buildApp({ linearPollService: { startRunsForIssues: vi.fn() } });

    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: { issueIds: [] } });

    expect(res.statusCode).toBe(400);
  });

  it("starts runs for the given issue ids", async () => {
    const { app, mockOrchestrator } = buildApp({
      linearPollService: {
        startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], failed: [] }),
      },
    });
    void mockOrchestrator;

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], failed: [] });
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const { app } = buildApp({
      linearPollService: { startRunsForIssues: vi.fn().mockRejectedValue(new Error("boom")) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
  });

  it("returns 500 with a stringified error when startRunsForIssues rejects with a non-Error value", async () => {
    const { app } = buildApp({
      linearPollService: { startRunsForIssues: vi.fn().mockRejectedValue("non-error") },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("non-error");
  });
});
