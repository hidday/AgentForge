import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyError, ValidationError } from "../../src/utils/errors.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
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

interface BuildOpts {
  orchestratorOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown>;
  registerOptions?: Record<string, unknown>;
}

async function buildApp(opts: BuildOpts = {}) {
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
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    ...opts.orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };

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
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator, mockProcessRunner };
}

describe("GET /api/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { runs } from runRepo.findAll() with no state filter", async () => {
    const run = makeRun();
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([run]);

    const res = await app.inject({ method: "GET", url: "/api/runs" });
    expect(res.statusCode).toBe(200);
    // Run dates are serialized to ISO strings over the wire.
    expect(res.json()).toEqual({ runs: [JSON.parse(JSON.stringify(run))] });
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
  });

  it("passes the state querystring through to runRepo.findAll()", async () => {
    const { app, mockRunRepo } = await buildApp();
    await app.inject({ method: "GET", url: "/api/runs?state=Todo" });
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Todo");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns run + artifacts + events when the run exists", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      run: JSON.parse(JSON.stringify(run)),
      artifacts: [{ id: "art-1" }],
      events: [{ id: "evt-1" }],
    });
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the run's artifacts when found", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-9" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ artifacts: [{ id: "art-9" }] });
  });
});

describe("GET /api/runs/:id/events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the run's events when found", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-7" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [{ id: "evt-7" }] });
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves the plan, kicks off execution in the background, and returns ok+state", async () => {
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

  it("sanitizes a blank note to undefined", async () => {
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

  it("returns 400 with the error message when approvePlan rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("not in right state"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "not in right state" });
  });

  it("does not fail the request even if the background runExecution rejects", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("background failure"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-plan" });
    expect(res.statusCode).toBe(200);
    // allow the background .catch() to flush
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires runManualReReview in the background and returns ok+runId", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

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

  it("returns 400 when runManualReReview throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("sync failure");
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/re-review-plan" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync failure" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires runManualPlanRevision in the background and returns ok+runId", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "address feedback" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "address feedback",
    });
  });

  it("returns 400 when runManualPlanRevision throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("sync revise failure");
    });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/revise-plan" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync revise failure" });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok+state on success", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 with the error message on failure", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("wrong state"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "wrong state" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);
    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });
    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with pause-ai and returns ok:true", async () => {
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

  it("returns 400 with the error message when handleCommand rejects", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot pause" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);
    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });
    expect(res.statusCode).toBe(404);
  });

  it("calls handleCommand with resume-ai and returns ok:true", async () => {
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

  it("returns 400 with the error message when handleCommand rejects", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot resume" });
  });
});

describe("POST /api/runs/:id/actions/answer-questions — additional error-path coverage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 409 when orchestrator throws PolicyError", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new PolicyError("policy blocked"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "a1" }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "policy blocked" });
  });

  it("returns 400 when orchestrator throws ValidationError", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new ValidationError("bad input"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "a1" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad input" });
  });

  it("returns 400 for a generic Error from the orchestrator", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new Error("generic failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "a1" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "generic failure" });
  });

  it("returns 400 when an answer item is missing questionId/answer", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "", answer: "a1" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with { ok, run } on success", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "a1" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, run: JSON.parse(JSON.stringify(run)) });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);
    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a state that is not retryable", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Retry is not supported for state");
  });

  const cases: [RunState, string][] = [
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ];

  for (const [state, method] of cases) {
    it(`for state ${state} triggers orchestrator.${method} and returns ok+retrying:true`, async () => {
      const run = makeRun({ state });
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      (mockOrchestrator[method] as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(mockOrchestrator[method]).toHaveBeenCalledWith("run-1");
    });
  }

  it("does not fail the request when the background retry trigger rejects", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry blew up"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("GET /api/runs/:id/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });
    expect(res.statusCode).toBe(404);
  });

  it("returns plan: null and default fields when there is no Plan artifact yet", async () => {
    const run = makeRun();
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
    expect(body.run.linearIssue.identifier).toBe("ENG-1");
  });

  it("maps plan risks that are plain strings, objects with description, and unknown shapes", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return {
          version: 2,
          payloadJson: {
            summary: "do the thing",
            confidence: 0.9,
            openQuestions: [{ id: "q1", question: "why?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Step 1", description: "do it" }],
            risks: ["plain string risk", { description: "object risk" }, { weird: true }, 42],
            testPlan: "run the tests",
          },
        };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.summary).toBe("do the thing");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "do it" }]);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ weird: true }));
    expect(body.plan.risks[3]).toBe("42");
    expect(body.plan.riskCount).toBe(4);
  });

  it("includes planReview, review, and executionReport payloads when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "PlanReview") return { version: 1, payloadJson: { verdict: "approve" } };
      if (type === "Review") return { version: 1, payloadJson: { verdict: "pass" } };
      if (type === "ExecutionReport") {
        return {
          version: 3,
          payloadJson: { executionVersion: 5, score: 8, scoreRationale: "solid" },
        };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json();
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "pass" } });
    expect(body.executionReport).toEqual({
      version: 3,
      executionVersion: 5,
      score: 8,
      scoreRationale: "solid",
      payload: { executionVersion: 5, score: 8, scoreRationale: "solid" },
    });
  });

  it("falls back to the artifact version as executionVersion when the payload omits it", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "ExecutionReport") return { version: 4, payloadJson: {} };
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = res.json();
    expect(body.executionReport.executionVersion).toBe(4);
  });
});

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes" });
    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toHaveLength(2);
  });

  it("filters active processes by the runId querystring", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });
    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when there is no output for the process id", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });
    expect(res.statusCode).toBe(404);
  });

  it("returns { processId, output } when output is available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "some log output" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(501);
  });

  it("returns { issues } on success", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-1" }]),
    };
    const { app } = await buildApp({ linearPollService });
    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "LIN-1" }] });
  });

  it("returns 500 with the error message when discoverPendingIssues rejects", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear api down")),
    };
    const { app } = await buildApp({ linearPollService });
    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "linear api down" });
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

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
    const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns { ok: true, ...result } on success", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["run-1"] }),
    };
    const { app } = await buildApp({ linearPollService });
    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["run-1"] });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 with the error message when startRunsForIssues rejects", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("ingest failed")),
    };
    const { app } = await buildApp({ linearPollService });
    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ingest failed" });
  });
});
