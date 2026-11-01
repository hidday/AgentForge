import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunEventEmitter } from "../../src/api/runEventEmitter.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
    linearIssueUrl: "https://linear.app/issue/ENG-42",
    repo: "test/repo",
    branchName: "main",
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 3,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

interface BuildAppOpts {
  linearPollService?: Record<string, unknown> | undefined;
  options?: Record<string, unknown>;
}

function buildMockRepos() {
  const runRepo = { findById: vi.fn(), findAll: vi.fn() };
  const artifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  };
  const eventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(undefined),
  };
  return { runRepo, artifactRepo, eventRepo };
}

async function buildApp(opts: BuildAppOpts = {}) {
  const { runRepo, artifactRepo, eventRepo } = buildMockRepos();

  const orchestrator = {
    getRunRepo: () => runRepo,
    getArtifactRepo: () => artifactRepo,
    getEventRepo: () => eventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
    getLinearClient: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn().mockResolvedValue(undefined),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
    retryRun: vi.fn().mockResolvedValue(undefined),
    answerQuestions: vi.fn(),
  };

  const emitter = new RunEventEmitter();

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
    opts.options ?? {},
  );
  await app.ready();

  return { app, runRepo, artifactRepo, eventRepo, orchestrator, emitter, processRunner };
}

describe("GET /api/runs", () => {
  it("returns all runs when no state filter is given", async () => {
    const { app, runRepo } = await buildApp();
    const runs = [makeRun(), makeRun({ id: "run-2" })];
    runRepo.findAll.mockResolvedValue(runs);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(runRepo.findAll).toHaveBeenCalledWith(undefined);
    expect(res.json()).toEqual({ runs: JSON.parse(JSON.stringify(runs)) });
  });

  it("passes the state querystring through to findAll", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findAll.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/api/runs?state=done" });

    expect(runRepo.findAll).toHaveBeenCalledWith("done");
  });
});

describe("GET /api/runs/:id", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("returns the run with its artifacts and events", async () => {
    const { app, runRepo, artifactRepo, eventRepo } = await buildApp();
    const run = makeRun();
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }]);
    eventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "a1" }]);
    expect(body.events).toEqual([{ id: "e1" }]);
    expect(artifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(eventRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
  });

  it("returns the run's artifacts", async () => {
    const { app, runRepo, artifactRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findByRunId.mockResolvedValue([{ id: "a1", type: "Plan" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ artifacts: [{ id: "a1", type: "Plan" }] });
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
  });

  it("returns the run's events", async () => {
    const { app, runRepo, eventRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    eventRepo.findByRunId.mockResolvedValue([{ id: "e1", eventType: "STATE_CHANGED" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [{ id: "e1", eventType: "STATE_CHANGED" }] });
  });
});

describe("POST /api/runs/:id/chat — workingDirectory fallback", () => {
  it("falls back to the repo root when workingDirectory is a cleaned-up worktree path", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "routes-worktree-root-"));
    const staleWorktreePath = join(repoRoot, ".worktrees", "run-1");
    const chatRun = vi.fn().mockResolvedValue({ text: "ok", durationMs: 42 });

    const { app, runRepo } = await buildApp({ options: { claudeCodeRunner: { chatRun } } });
    runRepo.findById.mockResolvedValue(makeRun({ workingDirectory: staleWorktreePath }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(chatRun).toHaveBeenCalledOnce();
    const [input] = chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(repoRoot);
  });

  it("returns 422 when workingDirectory is missing and no .worktrees fallback exists", async () => {
    const chatRun = vi.fn();
    const { app, runRepo } = await buildApp({ options: { claudeCodeRunner: { chatRun } } });
    runRepo.findById.mockResolvedValue(
      makeRun({ workingDirectory: "/definitely/does/not/exist-xyz" }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
    expect(chatRun).not.toHaveBeenCalled();
  });

  it("returns 422 when workingDirectory contains .worktrees but the stripped root also does not exist", async () => {
    const chatRun = vi.fn();
    const { app, runRepo } = await buildApp({ options: { claudeCodeRunner: { chatRun } } });
    runRepo.findById.mockResolvedValue(
      makeRun({ workingDirectory: "/definitely/missing-root/.worktrees/run-1" }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
    expect(chatRun).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, fires execution in the background, and returns the new state", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.approvePlan.mockResolvedValue({ id: "run-1", state: RunState.Implementing });
    orchestrator.runExecution.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "looks good" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
    expect(orchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
    expect(orchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("returns 400 with the error message when approvePlan rejects", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.approvePlan.mockRejectedValue(new Error("Plan already approved"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Plan already approved" });
  });

  it("does not fail the request when the background runExecution() rejects", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.approvePlan.mockResolvedValue({ id: "run-1", state: RunState.Implementing });
    orchestrator.runExecution.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    // allow the fire-and-forget rejection handler's microtask to run
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
  // The happy-path and context-validation behavior for this route are
  // covered by tests/api/reject-plan.route.test.ts; this covers the
  // `mode` validation branch specifically.
  it("returns 400 when mode is not 'iterate' or 'fresh'", async () => {
    const { app, orchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "not-a-real-mode" },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("mode must be one of");
    expect(orchestrator.rejectPlan).not.toHaveBeenCalled();
  });

  it("accepts mode: 'fresh' and passes it through to rejectPlan", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.rejectPlan.mockResolvedValue({ id: "run-1", state: RunState.Planning });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh" },
    });

    expect(res.statusCode).toBe(200);
    expect(orchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "fresh");
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("triggers a manual re-review and returns ok immediately", async () => {
    const { app, orchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: { note: "please re-check" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(orchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: "please re-check" });
  });

  it("does not fail the request when the background re-review rejects", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.runManualReReview.mockRejectedValue(new Error("busy"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });

  it("returns 400 when runManualReReview throws synchronously", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("cannot start review");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot start review" });
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("triggers a manual plan revision and returns ok immediately", async () => {
    const { app, orchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "adjust scope" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(orchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", { note: "adjust scope" });
  });

  it("returns 400 when runManualPlanRevision throws synchronously", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("cannot revise");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "cannot revise" });
  });

  it("does not fail the request when the background plan revision rejects", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.runManualPlanRevision.mockRejectedValue(new Error("revision busy"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("approves the human review and returns the new state", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.approveHumanReview.mockResolvedValue({ id: "run-1", state: RunState.Done });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when approveHumanReview rejects", async () => {
    const { app, orchestrator } = await buildApp();
    orchestrator.approveHumanReview.mockRejectedValue(new Error("not in review"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "not in review" });
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(res.statusCode).toBe(404);
  });

  it("sends a pause-ai command for the run's linear issue", async () => {
    const { app, runRepo, orchestrator } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(orchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "pause-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, runRepo, orchestrator } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    orchestrator.handleCommand.mockRejectedValue(new Error("already paused"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "already paused" });
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(res.statusCode).toBe(404);
  });

  it("sends a resume-ai command for the run's linear issue", async () => {
    const { app, runRepo, orchestrator } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(orchestrator.handleCommand).toHaveBeenCalledWith("LIN-1", { type: "resume-ai" });
  });

  it("returns 400 when handleCommand throws", async () => {
    const { app, runRepo, orchestrator } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    orchestrator.handleCommand.mockRejectedValue(new Error("already running"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "already running" });
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a state that is not retryable", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("Retry is not supported");
  });

  it.each([
    [RunState.Todo, "retryRun"],
    [RunState.Planning, "runPlanning"],
    [RunState.PlanRevision, "runPlanRevision"],
    [RunState.PlanReview, "runPlanReview"],
    [RunState.Implementing, "runExecution"],
    [RunState.AIReview, "runReview"],
    [RunState.AddressingReview, "runRemediation"],
  ] as const)("triggers %s via orchestrator.%s() and returns retrying: true", async (state, method) => {
    const { app, runRepo, orchestrator } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun({ state }));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
    expect((orchestrator as Record<string, ReturnType<typeof vi.fn>>)[method]).toHaveBeenCalledWith(
      "run-1",
    );
  });

  it("does not fail the request when the retried stage rejects in the background", async () => {
    const { app, runRepo, orchestrator } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    orchestrator.retryRun.mockRejectedValue(new Error("retry failed"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns null plan/review sections when no artifacts exist yet", async () => {
    const { app, runRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBeNull();
    expect(body.planReview).toBeNull();
    expect(body.review).toBeNull();
    expect(body.executionReport).toBeNull();
    expect(body.run.id).toBe("run-1");
    expect(body.run.linearIssue).toEqual({
      id: "LIN-1",
      identifier: "ENG-42",
      title: "Test Issue",
      url: "https://linear.app/issue/ENG-42",
      description: "Test issue",
    });
  });

  it("maps plan risks that are plain strings, objects with a description, and unknown shapes", async () => {
    const { app, runRepo, artifactRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return {
          version: 2,
          payloadJson: {
            summary: "Add auth",
            confidence: 0.9,
            openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
            risks: ["plain risk", { description: "object risk" }, { weird: "shape" }],
            testPlan: "unit tests",
          },
        };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.summary).toBe("Add auth");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.riskCount).toBe(3);
    expect(body.plan.risks[0]).toBe("plain risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toContain("weird");
  });

  it("includes planReview, review, and executionReport payloads when present", async () => {
    const { app, runRepo, artifactRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "PlanReview") return { version: 1, payloadJson: { verdict: "approve" } };
      if (type === "Review") return { version: 2, payloadJson: { verdict: "pass" } };
      if (type === "ExecutionReport") {
        return {
          version: 3,
          payloadJson: { executionVersion: 3, score: 0.8, scoreRationale: "solid" },
        };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 2, payload: { verdict: "pass" } });
    expect(body.executionReport).toMatchObject({
      version: 3,
      executionVersion: 3,
      score: 0.8,
      scoreRationale: "solid",
    });
  });

  it("falls back to the artifact's own version for executionVersion when payload omits it", async () => {
    const { app, runRepo, artifactRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "ExecutionReport") return { version: 7, payloadJson: null };
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.executionReport.executionVersion).toBe(7);
  });

  it("falls back to String(risk) when a risk object can't be JSON.stringify'd (circular reference)", async () => {
    const { app, runRepo, artifactRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    artifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return { version: 1, payloadJson: { summary: "x", risks: [circular] } };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.risks).toHaveLength(1);
    expect(typeof body.plan.risks[0]).toBe("string");
    expect(body.plan.risks[0]).toContain("object");
  });

  it("returns an empty steps array when the plan payload's steps field is not an array", async () => {
    const { app, runRepo, artifactRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") return { version: 1, payloadJson: { summary: "x" } };
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
  });
});

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const { app, processRunner } = await buildApp();
    const processes = [
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ];
    processRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes });
  });

  it("filters active processes by runId when provided", async () => {
    const { app, processRunner } = await buildApp();
    processRunner.getActiveProcesses.mockReturnValue([
      { id: "p1", runId: "run-1" },
      { id: "p2", runId: "run-2" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.json()).toEqual({ processes: [{ id: "p2", runId: "run-2" }] });
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns 404 when there is no output for the given process id", async () => {
    const { app, processRunner } = await buildApp();
    processRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/unknown/output" });

    expect(res.statusCode).toBe(404);
  });

  it("returns the process output", async () => {
    const { app, processRunner } = await buildApp();
    processRunner.getProcessOutput.mockReturnValue("some log output");

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

  it("returns discovered issues when configured", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "ISSUE-1" }]),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "ISSUE-1" }] });
  });

  it("returns 500 with the error message when discovery throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("Linear API down")),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Linear API down" });
  });

  it("stringifies a non-Error thrown value in the 500 response", async () => {
    const linearPollService = {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal -- exercises the `err instanceof Error` false branch
      discoverPendingIssues: vi.fn().mockRejectedValue("raw discovery failure"),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "raw discovery failure" });
  });
});

describe("POST /api/linear/ingest", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["ISSUE-1"] },
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

  it("starts runs for the given issue ids", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["ISSUE-1"], skipped: [] }),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["ISSUE-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["ISSUE-1"], skipped: [] });
  });

  it("returns 500 with the error message when startRunsForIssues throws", async () => {
    const linearPollService = {
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("ingest failed")),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["ISSUE-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ingest failed" });
  });

  it("stringifies a non-Error thrown value in the 500 response", async () => {
    const linearPollService = {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal -- exercises the `err instanceof Error` false branch
      startRunsForIssues: vi.fn().mockRejectedValue("raw ingest failure"),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["ISSUE-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "raw ingest failure" });
  });
});

describe("GET /api/events/stream (SSE)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    vi.useRealTimers();
    if (app) await app.close();
  });

  it("streams dashboard events to the client as SSE data frames", async () => {
    const built = await buildApp();
    app = built.app;

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const chunks: string[] = [];
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/events/stream`, {
      signal: controller.signal,
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Read the initial ":\n\n" comment frame.
    const first = await reader.read();
    chunks.push(decoder.decode(first.value));

    built.emitter.emitRunCreated("run-1", "ISSUE-1", "org/repo");

    const second = await reader.read();
    chunks.push(decoder.decode(second.value));

    expect(chunks.join("")).toContain('"type":"run:created"');
    expect(chunks.join("")).toContain('"runId":"run-1"');

    await reader.cancel();
    controller.abort();
  });

  it("sends a heartbeat frame every 15s and removes the dashboard listener on client disconnect", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const built = await buildApp();
    app = built.app;

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/events/stream`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    await reader.read(); // initial ":\n\n" comment frame
    expect(built.emitter.listenerCount("dashboard")).toBe(1);

    vi.advanceTimersByTime(15_000);
    const heartbeat = await reader.read();
    expect(decoder.decode(heartbeat.value)).toBe(":\n\n");

    await reader.cancel();
    controller.abort();
    // Real wait (setTimeout isn't faked) for the request.raw "close" handler
    // to run and tear down the listener + heartbeat interval.
    await new Promise((r) => setTimeout(r, 100));
    expect(built.emitter.listenerCount("dashboard")).toBe(0);
  });
});

describe("registerApiRoutes defaults", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a HUMAN_REQUESTED event with the expected eventType constant", () => {
    // Sanity check the enum value used by the request-human route elsewhere
    // in this file's sibling test, so a rename of the constant is caught.
    expect(RunEvent.HUMAN_REQUESTED).toBe("HUMAN_REQUESTED");
  });
});
