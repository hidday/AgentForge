import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes, type RegisterApiRoutesOptions } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/x",
    repo: "org/repo",
    branchName: "feature/x",
    prNumber: 7,
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

function buildMocks() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
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
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  return {
    mockRunRepo,
    mockArtifactRepo,
    mockEventRepo,
    mockOrchestrator,
    mockEmitter,
    mockProcessRunner,
  };
}

async function buildApp(
  opts: {
    linearPollService?: Record<string, unknown>;
    options?: RegisterApiRoutesOptions;
  } = {},
) {
  const mocks = buildMocks();

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mocks.mockOrchestrator as never,
    mocks.mockEmitter as never,
    mocks.mockProcessRunner as never,
    opts.linearPollService as never,
    opts.options ?? {},
  );

  await app.ready();
  return { app, ...mocks };
}

// Flush the microtask queue so fire-and-forget promise chains (.catch(...))
// attached inside route handlers get a chance to settle before assertions.
async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("GET /api/runs", () => {
  it("returns all runs when no state filter is given", async () => {
    const { app, mockRunRepo } = await buildApp();
    const runs = [makeRun(), makeRun({ id: "run-2" })];
    mockRunRepo.findAll.mockResolvedValue(runs);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    expect(res.json().runs).toHaveLength(2);
  });

  it("passes the state query param through to findAll", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Planning" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Planning");
  });
});

describe("GET /api/runs/:id", () => {
  it("returns run, artifacts and events when found", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }]);
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "a1" }]);
    expect(body.events).toEqual([{ id: "e1" }]);
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Run not found");
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns artifacts for an existing run", async () => {
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json().artifacts).toHaveLength(2);
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns events for an existing run", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([{ id: "e1" }]);
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  it("approves the plan, kicks off execution, and returns the new state", async () => {
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
    await flushPromises();
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
  });

  it("treats a blank note as absent", async () => {
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

  it("returns 400 when approvePlan rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Wrong state"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Wrong state");
  });

  it("logs but does not fail the request when background execution rejects", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await flushPromises();
    // No throw/unhandled rejection — the route swallows background failures.
  });
});

describe("POST /api/runs/:id/actions/reject-plan — additional branches", () => {
  it("returns 400 when mode is invalid", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "nonsense" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("mode must be one of");
  });

  it("accepts mode=fresh and forwards it to the orchestrator", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: "start over", mode: "fresh" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", "start over", "api", "fresh");
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  it("kicks off a manual re-review and returns ok", async () => {
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

  it("logs but does not fail the request when the background re-review rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("re-review failed"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await flushPromises();
  });

  it("returns 400 when starting the re-review throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("could not start");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("could not start");
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  it("kicks off a manual plan revision and returns ok", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "please revise" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, runId: "run-1" });
    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "please revise",
    });
  });

  it("logs but does not fail the request when the background revision rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("revision failed"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await flushPromises();
  });

  it("returns 400 when starting the revision throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("could not start revision");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("could not start revision");
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  it("approves human review and returns the new state", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
    expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
  });

  it("returns 400 when approveHumanReview rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("not ready"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not ready");
  });
});

describe("POST /api/runs/:id/actions/pause", () => {
  it("issues the pause-ai command for an existing run", async () => {
    const run = makeRun({ linearIssueId: "LIN-99" });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-99", { type: "pause-ai" });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when handleCommand rejects", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("command failed"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("command failed");
  });
});

describe("POST /api/runs/:id/actions/resume", () => {
  it("issues the resume-ai command for an existing run", async () => {
    const run = makeRun({ linearIssueId: "LIN-99" });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith("LIN-99", { type: "resume-ai" });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when handleCommand rejects", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("command failed"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("command failed");
  });
});

describe("POST /api/runs/:id/actions/retry", () => {
  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a non-retryable state", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Retry is not supported");
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
    it(`triggers ${method}() and returns retrying=true for state ${state}`, async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state }));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect(
        (mockOrchestrator as unknown as Record<string, ReturnType<typeof vi.fn>>)[method],
      ).toHaveBeenCalledWith("run-1");
    });
  }

  it("logs but does not fail the request when the retried stage rejects", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry failed"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await flushPromises();
  });
});

describe("POST /api/runs/:id/chat — working directory fallback", () => {
  it("returns 422 when the working directory is gone and has no .worktrees segment to fall back from", async () => {
    const missingDir = join(tmpdir(), `routes-more-missing-${Date.now()}`);
    const run = makeRun({ workingDirectory: missingDir });
    const chatRun = vi.fn().mockResolvedValue({ text: "reply", durationMs: 1 });
    const { app, mockRunRepo } = await buildApp({ options: { claudeCodeRunner: { chatRun } } });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain("Working directory not found");
    expect(chatRun).not.toHaveBeenCalled();
  });

  it("falls back to the main repo directory when the worktree under it is gone", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "routes-more-chat-"));
    const worktreePath = join(baseDir, ".worktrees", "run-x");
    const run = makeRun({ workingDirectory: worktreePath });
    const chatRun = vi.fn().mockResolvedValue({ text: "reply", durationMs: 1 });
    const { app, mockRunRepo } = await buildApp({ options: { claudeCodeRunner: { chatRun } } });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(chatRun).toHaveBeenCalledOnce();
    const [input] = chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(baseDir);
  });

  it("returns 422 when the .worktrees fallback directory is also gone", async () => {
    const missingBase = join(tmpdir(), `routes-more-missing-base-${Date.now()}`);
    const worktreePath = join(missingBase, ".worktrees", "run-y");
    const run = makeRun({ workingDirectory: worktreePath });
    const chatRun = vi.fn().mockResolvedValue({ text: "reply", durationMs: 1 });
    const { app, mockRunRepo } = await buildApp({ options: { claudeCodeRunner: { chatRun } } });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(chatRun).not.toHaveBeenCalled();
  });
});

describe("GET /api/runs/:id/summary", () => {
  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

    expect(res.statusCode).toBe(404);
  });

  it("returns nulls for plan/review/executionReport when no artifacts exist", async () => {
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
    expect(body.run.linearIssue.identifier).toBe("ENG-1");
  });

  it("builds a full summary including risk text normalization and execution report fallback", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const planPayload = {
      summary: "Implement feature X",
      confidence: 0.9,
      openQuestions: [{ id: "q1", question: "Which flag?", requiredForExecution: true }],
      steps: [{ id: "s1", title: "Step 1", description: "Do the thing" }],
      risks: ["raw string risk", { description: "object risk" }, { foo: "bar" }, circular],
      testPlan: "Run the unit tests",
    };

    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return { id: "art-plan", version: 3, payloadJson: planPayload };
      }
      if (type === "PlanReview") {
        return { id: "art-pr", version: 2, payloadJson: { verdict: "approved" } };
      }
      if (type === "Review") {
        return { id: "art-rev", version: 1, payloadJson: { verdict: "pass" } };
      }
      if (type === "ExecutionReport") {
        // payloadJson deliberately has no executionVersion/score to exercise the ?? fallback
        return { id: "art-exec", version: 5, payloadJson: null };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.plan.version).toBe(3);
    expect(body.plan.summary).toBe("Implement feature X");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.steps).toEqual([{ id: "s1", title: "Step 1", description: "Do the thing" }]);
    expect(body.plan.riskCount).toBe(4);
    expect(body.plan.risks[0]).toBe("raw string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(body.plan.risks[2]).toBe(JSON.stringify({ foo: "bar" }));
    // Circular risk object can't be JSON.stringify'd — falls back to String(r).
    expect(body.plan.risks[3]).toBe(String(circular));

    expect(body.planReview).toEqual({ version: 2, payload: { verdict: "approved" } });
    expect(body.review).toEqual({ version: 1, payload: { verdict: "pass" } });

    // executionVersion falls back to the artifact's own version when payload is null.
    expect(body.executionReport.version).toBe(5);
    expect(body.executionReport.executionVersion).toBe(5);
    expect(body.executionReport.score).toBeUndefined();
    expect(body.executionReport.payload).toBeNull();
  });

  it("uses executionReport payload fields (score, executionVersion) when present", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return {
          id: "art-exec",
          version: 2,
          payloadJson: { executionVersion: 9, score: 0.42, scoreRationale: "solid" },
        };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.executionReport.executionVersion).toBe(9);
    expect(body.executionReport.score).toBe(0.42);
    expect(body.executionReport.scoreRationale).toBe("solid");
  });

  it("defaults steps/openQuestions to [] when plan.steps/openQuestions are not arrays", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return { id: "art-plan", version: 1, payloadJson: { summary: "x" } };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    const body = res.json();
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.risks).toEqual([]);
    expect(body.plan.riskCount).toBe(0);
  });
});

describe("GET /api/processes", () => {
  it("returns all active processes when no runId filter is given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      {
        id: "p1",
        runId: "run-1",
        pid: 1,
        command: "x",
        stage: "s",
        runtime: "r",
        startedAt: "now",
        elapsedMs: 1,
      },
      {
        id: "p2",
        runId: "run-2",
        pid: 2,
        command: "x",
        stage: "s",
        runtime: "r",
        startedAt: "now",
        elapsedMs: 1,
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toHaveLength(2);
  });

  it("filters active processes by runId when given", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue([
      {
        id: "p1",
        runId: "run-1",
        pid: 1,
        command: "x",
        stage: "s",
        runtime: "r",
        startedAt: "now",
        elapsedMs: 1,
      },
      {
        id: "p2",
        runId: "run-2",
        pid: 2,
        command: "x",
        stage: "s",
        runtime: "r",
        startedAt: "now",
        elapsedMs: 1,
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].id).toBe("p2");
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns the output for an existing process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some log output");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "some log output" });
  });

  it("returns 404 when the process has no output available", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/linear/pending", () => {
  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
  });

  it("returns discovered issues when configured", async () => {
    const discoverPendingIssues = vi.fn().mockResolvedValue([{ id: "LIN-1" }]);
    const { app } = await buildApp({ linearPollService: { discoverPendingIssues } });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [{ id: "LIN-1" }] });
  });

  it("returns 500 when discovery throws", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue(new Error("linear down"));
    const { app } = await buildApp({ linearPollService: { discoverPendingIssues } });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("linear down");
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

  it("returns 400 when issueIds is missing or empty", async () => {
    const startRunsForIssues = vi.fn();
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(startRunsForIssues).not.toHaveBeenCalled();
  });

  it("starts runs for the given issue ids", async () => {
    const startRunsForIssues = vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] });
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
    expect(startRunsForIssues).toHaveBeenCalledWith(["LIN-1"]);
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue(new Error("ingest failed"));
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("ingest failed");
  });
});

describe("GET /api/events/stream", () => {
  // The SSE route never ends its response, so we invoke the registered
  // handler directly (capturing it via a spy on app.get) rather than using
  // app.inject(), which would hang waiting for the response to finish.
  async function captureStreamHandler() {
    const mocks = buildMocks();
    const app = Fastify({ logger: false });
    const getSpy = vi.spyOn(app, "get");

    registerApiRoutes(
      app,
      mocks.mockOrchestrator as never,
      mocks.mockEmitter as never,
      mocks.mockProcessRunner as never,
    );
    await app.ready();

    const call = getSpy.mock.calls.find((c) => c[0] === "/api/events/stream");
    if (!call) throw new Error("stream route not registered");
    const handler = call[1] as (request: unknown, reply: unknown) => void;
    return { handler, ...mocks, app };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes SSE headers, an initial comment, forwards dashboard events, sends heartbeats, and cleans up on close", async () => {
    const { handler, mockEmitter } = await captureStreamHandler();

    const writeHead = vi.fn();
    const write = vi.fn();
    const rawRequest = new EventEmitter();
    const request = { raw: rawRequest };
    const reply = { raw: { writeHead, write } };

    handler(request, reply);

    expect(writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    expect(write).toHaveBeenCalledWith(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

    const dashboardHandler = mockEmitter.on.mock.calls[0][1] as (event: unknown) => void;
    const event = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    dashboardHandler(event);
    expect(write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);

    write.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(write).toHaveBeenCalledWith(":\n\n");

    // Closing the underlying connection clears the heartbeat and unsubscribes.
    rawRequest.emit("close");
    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

    write.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(write).not.toHaveBeenCalled();
  });
});

// A non-Error throwable, used to exercise the `err instanceof Error ? ... :
// String(err)` fallback branches that every action route carries.
class NotAnError {
  toString() {
    return "not-an-error-value";
  }
}

describe("POST /api/runs/:id/chat — non-Error rejection branch", () => {
  it("falls back to String(err) when chatRun rejects with a non-Error value", async () => {
    const run = makeRun();
    const chatRun = vi.fn().mockRejectedValue("plain string failure");
    const { app, mockRunRepo } = await buildApp({ options: { claudeCodeRunner: { chatRun } } });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Chat request failed");
  });
});

describe("GET /api/runs/:id/skills — additional branches", () => {
  it("leaves injectedSkills empty when agentSkillRepo is unavailable, even with injection events", async () => {
    const { app, mockRunRepo, mockEventRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.getAgentSkillRepo.mockReturnValue(null);
    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["s1"] },
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json().injectedSkills).toEqual([]);
  });

  it("defaults skillIds to [] when the injection payload omits them", async () => {
    const mockAgentSkillRepo = { findById: vi.fn() };
    const { app, mockRunRepo, mockEventRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.getAgentSkillRepo.mockReturnValue(mockAgentSkillRepo);
    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json().injectedSkills).toEqual([]);
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("defaults shouldPersist to false and reason to '' when the distillation payload omits them", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.distillationDecision.shouldPersist).toBe(false);
    expect(body.distillationDecision.reason).toBe("");
  });

  it("returns 400 when the :id param resolves to an empty runId", async () => {
    const mocks = buildMocks();
    const app = Fastify({ logger: false });
    const getSpy = vi.spyOn(app, "get");
    registerApiRoutes(
      app,
      mocks.mockOrchestrator as never,
      mocks.mockEmitter as never,
      mocks.mockProcessRunner as never,
    );
    await app.ready();

    const call = getSpy.mock.calls.find((c) => c[0] === "/api/runs/:id/skills");
    if (!call) throw new Error("skills route not registered");
    const handler = call[1] as (request: unknown, reply: unknown) => Promise<unknown>;

    const codeFn = vi.fn().mockReturnThis();
    const sendFn = vi.fn();
    const reply = { code: codeFn, send: sendFn };
    await handler({ params: { id: "" } }, reply);

    expect(codeFn).toHaveBeenCalledWith(400);
    expect(sendFn).toHaveBeenCalledWith({ error: "runId is required" });
  });
});

describe("POST /api/runs/:id/actions/approve-plan — non-Error rejection branches", () => {
  it("falls back to String(err) when approvePlan itself rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new NotAnError());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not-an-error-value");
  });

  it("logError falls back to String(err) when the background execution rejects with a non-Error value", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new NotAnError());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await flushPromises();
  });
});

describe("POST /api/runs/:id/actions/reject-plan — non-Error rejection branch", () => {
  it("falls back to String(err) when rejectPlan rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockRejectedValue(new NotAnError());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not-an-error-value");
  });
});

describe("POST /api/runs/:id/actions/re-review-plan — non-Error rejection branches", () => {
  it("falls back to String(err) when starting re-review throws a non-Error value synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new NotAnError();
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not-an-error-value");
  });

  it("logError falls back to String(err) when the background re-review rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new NotAnError());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await flushPromises();
  });
});

describe("POST /api/runs/:id/actions/revise-plan — non-Error rejection branches", () => {
  it("falls back to String(err) when starting the revision throws a non-Error value synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new NotAnError();
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not-an-error-value");
  });

  it("logError falls back to String(err) when the background revision rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new NotAnError());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await flushPromises();
  });
});

describe("POST /api/runs/:id/actions/approve-review — non-Error rejection branch", () => {
  it("falls back to String(err) when approveHumanReview rejects with a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new NotAnError());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not-an-error-value");
  });
});

describe("POST /api/runs/:id/actions/pause — non-Error rejection branch", () => {
  it("falls back to String(err) when handleCommand rejects with a non-Error value", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new NotAnError());

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not-an-error-value");
  });
});

describe("POST /api/runs/:id/actions/resume — non-Error rejection branch", () => {
  it("falls back to String(err) when handleCommand rejects with a non-Error value", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockOrchestrator.handleCommand.mockRejectedValue(new NotAnError());

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not-an-error-value");
  });
});

describe("POST /api/runs/:id/actions/answer-questions — non-Error rejection branch", () => {
  it("falls back to String(err) when answerQuestions rejects with a value that is not an Error, PolicyError or ValidationError", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new NotAnError());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not-an-error-value");
  });

  it("uses err.message when answerQuestions rejects with a plain Error (not Policy/ValidationError)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new Error("generic failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("generic failure");
  });
});

describe("POST /api/runs/:id/actions/retry — non-Error rejection branch", () => {
  it("logError falls back to String(err) when the retried stage rejects with a non-Error value", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue(new NotAnError());

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
    await flushPromises();
  });
});

describe("POST /api/runs/:id/actions/request-human — additional branches", () => {
  function buildRequestHumanApp(
    overrides: {
      events?: unknown[];
      isConfigured?: boolean;
      debounceHours?: number;
      uiBaseUrl?: string;
      withNotificationService?: boolean;
    } = {},
  ) {
    const sendHumanRequest = vi.fn().mockResolvedValue({
      slack: { attempted: true, ok: true },
      email: { attempted: false, ok: false },
    });
    const notificationService =
      overrides.withNotificationService === false
        ? undefined
        : {
            isConfigured: () => overrides.isConfigured ?? true,
            sendHumanRequest,
          };

    return buildApp({
      options: {
        notificationService: notificationService as never,
        uiBaseUrl: overrides.uiBaseUrl,
        debounceHours: overrides.debounceHours,
      },
    }).then((base) => ({ ...base, sendHumanRequest }));
  }

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildRequestHumanApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("uses default debounceHours and uiBaseUrl when options omit them", async () => {
    const { app, mockRunRepo, mockEventRepo, sendHumanRequest } = await buildRequestHumanApp({
      debounceHours: undefined,
      uiBaseUrl: undefined,
    });
    mockRunRepo.findById.mockResolvedValue(makeRun({ linearIssueIdentifier: null }));
    mockEventRepo.findByRunId.mockResolvedValue([]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "no explicit options given" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as {
      runUrl: string;
      linearIssue: { identifier?: string };
    };
    // Default uiBaseUrl is http://localhost:5173.
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
    // A null linearIssueIdentifier normalizes to undefined via `?? undefined`.
    expect(payload.linearIssue.identifier).toBeUndefined();
  });

  it("skips stale HUMAN_REQUESTED events and ignores events of other types when checking debounce", async () => {
    const staleTs = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10h ago, outside a 6h window
    const { app, mockRunRepo, mockEventRepo, sendHumanRequest } = await buildRequestHumanApp({
      debounceHours: 6,
    });
    mockRunRepo.findById.mockResolvedValue(makeRun());
    mockEventRepo.findByRunId.mockResolvedValue([
      { eventType: "RUN_STATE_CHANGED", createdAt: new Date(), payloadJson: {} },
      { eventType: "HUMAN_REQUESTED", createdAt: staleTs, payloadJson: { reason: "other" } },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "fresh request despite stale history" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/linear/pending — non-Error rejection branch", () => {
  it("falls back to String(err) when discoverPendingIssues rejects with a non-Error value", async () => {
    const discoverPendingIssues = vi.fn().mockRejectedValue(new NotAnError());
    const { app } = await buildApp({ linearPollService: { discoverPendingIssues } });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("not-an-error-value");
  });
});

describe("POST /api/linear/ingest — non-Error rejection branch", () => {
  it("falls back to String(err) when startRunsForIssues rejects with a non-Error value", async () => {
    const startRunsForIssues = vi.fn().mockRejectedValue(new NotAnError());
    const { app } = await buildApp({ linearPollService: { startRunsForIssues } });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("not-an-error-value");
  });
});
