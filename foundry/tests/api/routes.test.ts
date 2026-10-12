import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

/**
 * Covers the routes.ts endpoints that are NOT already exercised by:
 *   - request-human.route.test.ts
 *   - answer-questions.route.test.ts
 *   - reject-plan.route.test.ts
 *   - routes.chat.test.ts
 *   - runsSkills.test.ts
 *
 * i.e. list/single run, artifacts, events, approve-plan, re-review-plan,
 * revise-plan, approve-review, pause, resume, retry, summary, processes,
 * linear polling, and the SSE stream.
 */

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "Some issue",
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
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

interface BuildAppOptions {
  runRepoOverrides?: Record<string, unknown>;
  artifactRepoOverrides?: Record<string, unknown>;
  eventRepoOverrides?: Record<string, unknown>;
  orchestratorOverrides?: Record<string, unknown>;
  processRunnerOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown> | undefined;
  registerOptions?: Record<string, unknown>;
}

async function buildApp(opts: BuildAppOptions = {}) {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    ...opts.runRepoOverrides,
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    ...opts.artifactRepoOverrides,
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    ...opts.eventRepoOverrides,
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: () => undefined,
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
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
    opts.registerOptions ?? {},
  );
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator, mockProcessRunner };
}

describe("GET /api/runs", () => {
  it("returns the list of runs from findAll with no state filter", async () => {
    const runs = [makeRun(), makeRun({ id: "run-2" })];
    const { app, mockRunRepo } = await buildApp({
      runRepoOverrides: { findAll: vi.fn().mockResolvedValue(runs) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { runs: unknown[] };
    expect(body.runs).toHaveLength(2);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
  });

  it("passes the state querystring through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();

    const response = await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(response.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  it("returns run, artifacts and events for an existing run", async () => {
    const run = makeRun();
    const artifacts = [{ id: "art-1" }];
    const events = [{ id: "evt-1" }];
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findByRunId: vi.fn().mockResolvedValue(artifacts) },
      eventRepoOverrides: { findByRunId: vi.fn().mockResolvedValue(events) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { run: unknown; artifacts: unknown; events: unknown };
    expect(body.run).toMatchObject({ id: "run-1" });
    expect(body.artifacts).toEqual(artifacts);
    expect(body.events).toEqual(events);
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(null) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error).toBe("Run not found");
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns artifacts for an existing run", async () => {
    const run = makeRun();
    const artifacts = [{ id: "art-1" }, { id: "art-2" }];
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findByRunId: vi.fn().mockResolvedValue(artifacts) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ artifacts });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(null) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns events for an existing run", async () => {
    const run = makeRun();
    const events = [{ id: "evt-1" }];
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      eventRepoOverrides: { findByRunId: vi.fn().mockResolvedValue(events) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ events });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(null) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, kicks off execution, and returns the new state", async () => {
    const run = makeRun({ state: RunState.Implementing });
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: {
        approvePlan: vi.fn().mockResolvedValue(run),
        runExecution: vi.fn().mockResolvedValue(run),
      },
    });

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

  it("omits the note when it is whitespace-only", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: {
        approvePlan: vi.fn().mockResolvedValue(run),
        runExecution: vi.fn().mockResolvedValue(run),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });

  it("returns 400 when approvePlan rejects", async () => {
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: {
        approvePlan: vi.fn().mockRejectedValue(new Error("Invalid state transition")),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid state transition");
    expect(mockOrchestrator.runExecution).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("returns 200 and triggers runManualReReview with a sanitized note", async () => {
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: {
        runManualReReview: vi.fn().mockResolvedValue(makeRun()),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", {
      note: "please re-check",
    });
  });

  it("caps an overly long note to MAX_OPERATOR_NOTE_LENGTH", async () => {
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: {
        runManualReReview: vi.fn().mockResolvedValue(makeRun()),
      },
    });
    const longNote = "x".repeat(5000);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: longNote },
    });

    expect(response.statusCode).toBe(200);
    const calledNote = (mockOrchestrator.runManualReReview as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { note?: string };
    expect(calledNote.note).toHaveLength(4000);
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("returns 200 and triggers runManualPlanRevision with a sanitized note", async () => {
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: {
        runManualPlanRevision: vi.fn().mockResolvedValue(makeRun()),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: 12345 },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, runId: "run-1" });
    // non-string note sanitizes to undefined
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: undefined,
    });
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("returns 200 with the new state on success", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: { approveHumanReview: vi.fn().mockResolvedValue(run) },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, state: RunState.Done });
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 when approveHumanReview rejects", async () => {
    const { app } = await buildApp({
      orchestratorOverrides: {
        approveHumanReview: vi.fn().mockRejectedValue(new Error("Wrong state")),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Wrong state");
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockOrchestrator } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(null) },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/pause",
    });

    expect(response.statusCode).toBe(404);
    expect(mockOrchestrator.handleCommand).not.toHaveBeenCalled();
  });

  it("returns 200 and calls handleCommand with pause-ai", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      orchestratorOverrides: { handleCommand: vi.fn().mockResolvedValue(undefined) },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/pause",
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand rejects", async () => {
    const run = makeRun();
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      orchestratorOverrides: {
        handleCommand: vi.fn().mockRejectedValue(new Error("cannot pause")),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/pause",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("cannot pause");
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(null) },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/resume",
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 200 and calls handleCommand with resume-ai", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      orchestratorOverrides: { handleCommand: vi.fn().mockResolvedValue(undefined) },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/resume",
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand rejects", async () => {
    const run = makeRun();
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      orchestratorOverrides: {
        handleCommand: vi.fn().mockRejectedValue(new Error("cannot resume")),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/resume",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("cannot resume");
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(null) },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/retry",
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for a non-retryable state", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/retry",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("Retry is not supported");
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
    it(`triggers orchestrator.${method} for state ${state}`, async () => {
      const run = makeRun({ state });
      const { app, mockOrchestrator } = await buildApp({
        runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
        orchestratorOverrides: {
          [method]: vi.fn().mockResolvedValue(run),
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/retry",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        ok: boolean;
        runId: string;
        state: string;
        retrying: boolean;
      };
      expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(
        (mockOrchestrator[method as keyof typeof mockOrchestrator] as ReturnType<typeof vi.fn>)
          .mock.calls[0][0],
      ).toBe("run-1");
    });
  }
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(null) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(response.statusCode).toBe(404);
  });

  it("returns nulls for plan/planReview/review/executionReport when none exist", async () => {
    const run = makeRun();
    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findLatestByType: vi.fn().mockResolvedValue(null) },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect((body.run as { id: string }).id).toBe("run-1");
  });

  it("builds a full summary and normalizes risks of mixed shapes", async () => {
    const run = makeRun();
    const planArtifact = {
      id: "art-plan",
      version: 3,
      payloadJson: {
        summary: "Add login flow",
        confidence: 0.9,
        openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
        steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
        risks: ["plain string risk", { description: "object risk" }, 10n],
        testPlan: "run unit tests",
      },
    };
    const planReviewArtifact = { version: 1, payloadJson: { verdict: "approved" } };
    const reviewArtifact = { version: 2, payloadJson: { verdict: "needs-changes" } };
    const executionArtifact = {
      version: 4,
      payloadJson: { executionVersion: 4, score: 0.8, scoreRationale: "solid" },
    };

    const findLatestByType = vi.fn().mockImplementation((_runId: string, type: string) => {
      switch (type) {
        case "Plan":
          return Promise.resolve(planArtifact);
        case "PlanReview":
          return Promise.resolve(planReviewArtifact);
        case "Review":
          return Promise.resolve(reviewArtifact);
        case "ExecutionReport":
          return Promise.resolve(executionArtifact);
        default:
          return Promise.resolve(null);
      }
    });

    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findLatestByType },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      plan: { risks: string[]; riskCount: number; stepCount: number };
      planReview: { version: number; payload: unknown };
      review: { version: number; payload: unknown };
      executionReport: { version: number; executionVersion: number; score: number };
    };

    expect(body.plan.risks).toEqual(["plain string risk", "object risk", "10"]);
    expect(body.plan.riskCount).toBe(3);
    expect(body.plan.stepCount).toBe(1);
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 2, payload: { verdict: "needs-changes" } });
    expect(body.executionReport).toMatchObject({ version: 4, executionVersion: 4, score: 0.8 });
  });

  it("falls back executionVersion to the artifact version when payload omits it", async () => {
    const run = makeRun();
    const executionArtifact = { version: 7, payloadJson: {} };
    const findLatestByType = vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
      return Promise.resolve(null);
    });

    const { app } = await buildApp({
      runRepoOverrides: { findById: vi.fn().mockResolvedValue(run) },
      artifactRepoOverrides: { findLatestByType },
    });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { executionReport: { executionVersion: number } };
    expect(body.executionReport.executionVersion).toBe(7);
  });
});

describe("GET /api/processes", () => {
  it("returns all active processes with no runId filter", async () => {
    const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
    const { app } = await buildApp({
      processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ processes });
  });

  it("filters processes by runId when provided", async () => {
    const processes = [{ id: "p1", runId: "run-1" }, { id: "p2", runId: "run-2" }];
    const { app } = await buildApp({
      processRunnerOverrides: { getActiveProcesses: vi.fn().mockReturnValue(processes) },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ processes: [{ id: "p2", runId: "run-2" }] });
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns 404 when there is no output for the process", async () => {
    const { app } = await buildApp({
      processRunnerOverrides: { getProcessOutput: vi.fn().mockReturnValue(null) },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(response.statusCode).toBe(404);
  });

  it("returns the output for an existing process", async () => {
    const { app } = await buildApp({
      processRunnerOverrides: { getProcessOutput: vi.fn().mockReturnValue("build log output") },
    });

    const response = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ processId: "p1", output: "build log output" });
  });
});

describe("GET /api/linear/pending", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.body).error).toContain("Linear polling not available");
  });

  it("returns issues discovered by the poll service", async () => {
    const issues = [{ id: "LIN-1" }, { id: "LIN-2" }];
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue(issues),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ issues });
  });

  it("returns 500 when discoverPendingIssues rejects", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API down")),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe("Linear API down");
  });
});

describe("POST /api/linear/ingest", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(501);
  });

  it("returns 400 when issueIds is missing", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("issueIds");
  });

  it("returns 400 when issueIds is an empty array", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns the result from startRunsForIssues on success", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      started: ["LIN-1"],
      skipped: [],
    });
    expect(linearPollService.startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 when startRunsForIssues rejects", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("DB unavailable")),
    };
    const { app } = await buildApp({ linearPollService });

    const response = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe("DB unavailable");
  });
});

describe("GET /api/events/stream (SSE)", () => {
  // light-my-request's inject() waits for the raw response to end, but this
  // route never calls reply.raw.end() (it stays open until the client
  // disconnects). We exercise the handler directly against fake Fastify
  // request/reply objects instead of going through app.inject(), the same
  // way the real HTTP server would drive it.
  let fakeApp: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; log: Record<string, ReturnType<typeof vi.fn>> };
  let handlers: Map<string, (request: unknown, reply: unknown) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = new Map();
    fakeApp = {
      get: vi.fn((path: string, handler: (request: unknown, reply: unknown) => void) => {
        handlers.set(`GET ${path}`, handler);
      }),
      post: vi.fn((path: string, handler: (request: unknown, reply: unknown) => void) => {
        handlers.set(`POST ${path}`, handler);
      }),
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function registerAndGetStreamHandler() {
    const mockOrchestrator = {
      getRunRepo: () => ({ findAll: vi.fn(), findById: vi.fn() }),
      getArtifactRepo: () => ({ findByRunId: vi.fn(), findLatestByType: vi.fn() }),
      getEventRepo: () => ({ findByRunId: vi.fn(), create: vi.fn() }),
      getAgentSkillRepo: () => undefined,
    };
    const mockEmitter = new EventEmitter();
    const onSpy = vi.spyOn(mockEmitter, "on");
    const offSpy = vi.spyOn(mockEmitter, "off");
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      fakeApp as never,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = handlers.get("GET /api/events/stream");
    if (!handler) throw new Error("stream handler not registered");
    return { handler, mockEmitter, onSpy, offSpy };
  }

  it("writes SSE headers, an initial comment, and subscribes to dashboard events", () => {
    const { handler, onSpy } = registerAndGetStreamHandler();
    const requestRaw = new EventEmitter();
    const reply = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const request = { raw: requestRaw };

    handler(request, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(":\n\n");
    expect(onSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));
  });

  it("forwards emitted dashboard events to the client as SSE data frames", () => {
    const { handler, mockEmitter } = registerAndGetStreamHandler();
    const reply = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const request = { raw: new EventEmitter() };

    handler(request, reply);

    const event = {
      type: "run:created" as const,
      runId: "run-1",
      issueId: "LIN-1",
      repo: "repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    mockEmitter.emit("dashboard", event);

    expect(reply.raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("sends a heartbeat comment every 15 seconds", () => {
    const { handler } = registerAndGetStreamHandler();
    const reply = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const request = { raw: new EventEmitter() };

    handler(request, reply);
    const writeCallsBefore = reply.raw.write.mock.calls.length;

    vi.advanceTimersByTime(15_000);

    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsBefore + 1);
    expect(reply.raw.write).toHaveBeenLastCalledWith(":\n\n");
  });

  it("unsubscribes and stops the heartbeat when the client disconnects", () => {
    const { handler, mockEmitter, offSpy } = registerAndGetStreamHandler();
    const reply = { raw: { writeHead: vi.fn(), write: vi.fn() } };
    const requestRaw = new EventEmitter();
    const request = { raw: requestRaw };

    handler(request, reply);
    const writeCallsBefore = reply.raw.write.mock.calls.length;

    requestRaw.emit("close");

    expect(offSpy).toHaveBeenCalledWith("dashboard", expect.any(Function));
    expect(mockEmitter.listenerCount("dashboard")).toBe(0);

    // heartbeat interval should be cleared — advancing time produces no more writes
    vi.advanceTimersByTime(60_000);
    expect(reply.raw.write).toHaveBeenCalledTimes(writeCallsBefore);
  });
});
