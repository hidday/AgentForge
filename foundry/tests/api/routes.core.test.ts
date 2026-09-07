import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyError, ValidationError } from "../../src/utils/errors.js";

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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

interface BuildOpts {
  run?: ReturnType<typeof makeRun> | null;
  artifacts?: unknown[];
  events?: unknown[];
  linearPollService?: Record<string, unknown> | undefined;
  agentSkillRepo?: Record<string, unknown> | undefined;
}

function buildApp(opts: BuildOpts = {}) {
  const run = opts.run === undefined ? makeRun() : opts.run;

  const runRepo = {
    findAll: vi.fn().mockResolvedValue([run].filter(Boolean)),
    findById: vi.fn().mockResolvedValue(run),
  };
  const artifactRepo = {
    findByRunId: vi.fn().mockResolvedValue(opts.artifacts ?? []),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
  };
  const eventRepo = {
    findByRunId: vi.fn().mockResolvedValue(opts.events ?? []),
    create: vi.fn().mockResolvedValue({}),
  };

  const orchestrator = {
    getRunRepo: () => runRepo,
    getArtifactRepo: () => artifactRepo,
    getEventRepo: () => eventRepo,
    getAgentSkillRepo: () => opts.agentSkillRepo,
    approvePlan: vi.fn().mockResolvedValue(makeRun({ state: RunState.Implementing })),
    rejectPlan: vi.fn().mockResolvedValue(makeRun({ state: RunState.Planning })),
    approveHumanReview: vi.fn().mockResolvedValue(makeRun({ state: RunState.Done })),
    handleCommand: vi.fn().mockResolvedValue(undefined),
    answerQuestions: vi.fn().mockResolvedValue(makeRun()),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
  };

  const emitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const processRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    orchestrator as never,
    emitter as never,
    processRunner as never,
    opts.linearPollService as never,
    {},
  );

  return { app, orchestrator, runRepo, artifactRepo, eventRepo, emitter, processRunner };
}

describe("GET /api/runs", () => {
  it("lists all runs, optionally filtered by query state", async () => {
    const { app, runRepo } = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/runs?state=Todo" });

    expect(response.statusCode).toBe(200);
    expect(runRepo.findAll).toHaveBeenCalledWith("Todo");
    expect(JSON.parse(response.body).runs).toHaveLength(1);
  });
});

describe("GET /api/runs/:id", () => {
  it("returns the run with its artifacts and events", async () => {
    const { app } = buildApp({ artifacts: [{ id: "a1" }], events: [{ id: "e1" }] });
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toHaveLength(1);
    expect(body.events).toHaveLength(1);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: "Run not found" });
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns the run's artifacts", async () => {
    const { app } = buildApp({ artifacts: [{ id: "a1" }, { id: "a2" }] });
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).artifacts).toHaveLength(2);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns the run's events", async () => {
    const { app } = buildApp({ events: [{ id: "e1" }] });
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).events).toHaveLength(1);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, kicks off execution in the background, and returns the new state", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "  looks good  " },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, state: RunState.Implementing });
    expect(orchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(orchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("returns 400 when the orchestrator throws", async () => {
    const { app, orchestrator } = buildApp();
    orchestrator.approvePlan.mockRejectedValueOnce(new Error("cannot approve"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "cannot approve" });
  });
});

describe("POST /api/runs/:id/actions/reject-plan", () => {
  it("rejects with default mode 'iterate' when no body is given", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "iterate");
  });

  it("accepts a valid mode and string context", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: "use OAuth", mode: "fresh" },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.rejectPlan).toHaveBeenCalledWith("run-1", "use OAuth", "api", "fresh");
  });

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

  it("returns 400 when context is not a string", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: 123 },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("context must be a string");
  });

  it("returns 400 when the orchestrator throws", async () => {
    const { app, orchestrator } = buildApp();
    orchestrator.rejectPlan.mockRejectedValueOnce(new Error("boom"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("triggers re-review in the background and returns immediately", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please double check" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, runId: "run-1" });
    expect(orchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: "please double check" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("triggers manual plan revision in the background", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", { note: undefined });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("approves the human review and returns the new state", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, state: RunState.Done });
    expect(orchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 on failure", async () => {
    const { app, orchestrator } = buildApp();
    orchestrator.approveHumanReview.mockRejectedValueOnce(new Error("not ready"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/runs/:id/actions/pause and /resume", () => {
  it("pause sends a pause-ai command using the run's linearIssueId", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("pause returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(response.statusCode).toBe(404);
  });

  it("resume sends a resume-ai command", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("resume returns 400 when handleCommand throws", async () => {
    const { app, orchestrator } = buildApp();
    orchestrator.handleCommand.mockRejectedValueOnce(new Error("bad state"));

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/runs/:id/actions/answer-questions -- validation edge cases", () => {
  it("returns 400 when answers is missing", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when an answer entry is missing questionId", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ answer: "yes" }] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("maps a PolicyError to 409", async () => {
    const { app, orchestrator } = buildApp();
    orchestrator.answerQuestions.mockRejectedValueOnce(new PolicyError("wrong state"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({ error: "wrong state" });
  });

  it("maps a ValidationError to 400", async () => {
    const { app, orchestrator } = buildApp();
    orchestrator.answerQuestions.mockRejectedValueOnce(new ValidationError("bad answer"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "bad answer" });
  });

  it("maps a generic error to 400", async () => {
    const { app, orchestrator } = buildApp();
    orchestrator.answerQuestions.mockRejectedValueOnce(new Error("unexpected"));

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("succeeds with a well-formed answers array", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.answerQuestions).toHaveBeenCalledWith("run-1", [
      { questionId: "q1", answer: "yes" },
    ]);
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for a non-retryable state", async () => {
    const { app } = buildApp({ run: makeRun({ state: RunState.Done }) });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("Retry is not supported");
  });

  it.each([
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ])("triggers the correct orchestrator method for state %s", async (state, method) => {
    const { app, orchestrator } = buildApp({ run: makeRun({ state }) });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
    expect((orchestrator as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]).toHaveBeenCalled();
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = buildApp({ run: null });
    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });
    expect(response.statusCode).toBe(404);
  });

  it("returns a null plan/planReview/review/executionReport when no artifacts exist", async () => {
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

  it("summarizes a plan artifact including string and object risks", async () => {
    const { app, artifactRepo } = buildApp();
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 2,
          payloadJson: {
            summary: "Do the thing",
            confidence: 0.8,
            openQuestions: [],
            steps: [{ id: "s1", title: "Step", description: "d" }],
            risks: ["plain risk", { description: "object risk" }, { weird: "shape" }],
            testPlan: "run tests",
          },
        });
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = JSON.parse(response.body);

    expect(body.plan.version).toBe(2);
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.risks).toEqual(["plain risk", "object risk", '{"weird":"shape"}']);
    expect(body.plan.riskCount).toBe(3);
  });

  it("summarizes planReview, review, and executionReport artifacts when present", async () => {
    const { app, artifactRepo } = buildApp();
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve({ version: 1, payloadJson: { ok: true } });
      if (type === "Review") return Promise.resolve({ version: 1, payloadJson: { ok: true } });
      if (type === "ExecutionReport") {
        return Promise.resolve({
          version: 1,
          payloadJson: { executionVersion: 2, score: 0.9, scoreRationale: "good" },
        });
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = JSON.parse(response.body);

    expect(body.planReview).toEqual({ version: 1, payload: { ok: true } });
    expect(body.review).toEqual({ version: 1, payload: { ok: true } });
    expect(body.executionReport.executionVersion).toBe(2);
    expect(body.executionReport.score).toBe(0.9);
  });

  it("returns an empty steps array when the plan payload's steps is not an array", async () => {
    const { app, artifactRepo } = buildApp();
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          version: 1,
          payloadJson: {
            summary: "No steps array",
            confidence: 0.5,
            openQuestions: [],
            steps: undefined,
            risks: [],
            testPlan: "n/a",
          },
        });
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = JSON.parse(response.body);

    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
  });

  it("falls back executionVersion to the artifact version when payload lacks it", async () => {
    const { app, artifactRepo } = buildApp();
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({ version: 5, payloadJson: {} });
      }
      return Promise.resolve(null);
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    const body = JSON.parse(response.body);

    expect(body.executionReport.executionVersion).toBe(5);
  });
});

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const { app, processRunner } = buildApp();
    (processRunner.getActiveProcesses as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const response = await app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).processes).toHaveLength(2);
  });

  it("filters by runId when provided", async () => {
    const { app, processRunner } = buildApp();
    (processRunner.getActiveProcesses as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    const body = JSON.parse(response.body);
    expect(body.processes).toEqual([{ id: "p2", runId: "run-2" }]);
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns 404 when the process has no output", async () => {
    const { app } = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/processes/missing/output" });
    expect(response.statusCode).toBe(404);
  });

  it("returns the process output when found", async () => {
    const { app, processRunner } = buildApp();
    (processRunner.getProcessOutput as ReturnType<typeof vi.fn>).mockReturnValue("some output");

    const response = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ processId: "p1", output: "some output" });
  });
});

describe("GET /api/linear/pending", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = buildApp({ linearPollService: undefined });
    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });
    expect(response.statusCode).toBe(501);
  });

  it("returns discovered issues when configured", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "i1" }]),
    };
    const { app } = buildApp({ linearPollService });
    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).issues).toEqual([{ id: "i1" }]);
  });

  it("returns 500 when discovery throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear down")),
    };
    const { app } = buildApp({ linearPollService });
    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
  });
});

describe("POST /api/linear/ingest", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = buildApp({ linearPollService: undefined });
    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["i1"] },
    });
    expect(response.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing or empty", async () => {
    const linearPollService = { startRunsForIssues: vi.fn() };
    const { app } = buildApp({ linearPollService });
    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("starts runs for the given issue ids", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["i1"], skipped: [] }),
    };
    const { app } = buildApp({ linearPollService });
    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["i1"] },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, started: ["i1"], skipped: [] });
  });

  it("returns 500 when starting runs throws", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("db down")),
    };
    const { app } = buildApp({ linearPollService });
    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["i1"] },
    });

    expect(response.statusCode).toBe(500);
  });
});

describe("skills endpoint edge cases not covered by tests/api/runsSkills.test.ts", () => {
  it("returns nulls when there are no SKILL_INJECTION or SKILL_DISTILLATION events", async () => {
    const { app } = buildApp({ events: [], agentSkillRepo: { findById: vi.fn() } });
    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.injectedSkills).toEqual([]);
    expect(body.distillationDecision).toBeNull();
    expect(body.distilledSkill).toBeNull();
  });
});
