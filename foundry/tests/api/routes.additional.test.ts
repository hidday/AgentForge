import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes, type RegisterApiRoutesOptions } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyError, ValidationError } from "../../src/utils/errors.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Some description",
    linearIssueTitle: "Add auth middleware",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
    repo: "test-repo",
    branchName: "feature/auth",
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
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

interface BuildAppOpts {
  orchestratorOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown> | undefined;
  options?: RegisterApiRoutesOptions;
  processRunnerOverrides?: Record<string, unknown>;
}

async function buildApp(opts: BuildAppOpts = {}) {
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(makeRun()),
    findAll: vi.fn().mockResolvedValue([]),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((params) => ({
      id: `artifact-${Math.random()}`,
      ...params,
      createdAt: new Date(),
    })),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  };
  const mockAgentSkillRepo = {
    findById: vi.fn().mockResolvedValue(null),
    findByRepoCategoryNearTime: vi.fn().mockResolvedValue(null),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(mockAgentSkillRepo),
    answerQuestions: vi.fn(),
    approvePlan: vi.fn().mockResolvedValue(makeRun()),
    rejectPlan: vi.fn().mockResolvedValue(makeRun()),
    approveHumanReview: vi.fn().mockResolvedValue(makeRun()),
    handleCommand: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    retryRun: vi.fn().mockResolvedValue(undefined),
    ...opts.orchestratorOverrides,
  };

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
    opts.options ?? {},
  );

  await app.ready();
  return {
    app,
    mockRunRepo,
    mockArtifactRepo,
    mockEventRepo,
    mockAgentSkillRepo,
    mockOrchestrator,
    mockEmitter,
    mockProcessRunner,
  };
}

describe("GET /api/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all runs with no state filter", async () => {
    const { app, mockRunRepo } = await buildApp();
    const runs = [makeRun()];
    mockRunRepo.findAll.mockResolvedValue(runs);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    expect(res.json().runs).toHaveLength(1);
  });

  it("passes the state query through to the repository", async () => {
    const { app, mockRunRepo } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(res.statusCode).toBe(200);
    expect(mockRunRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Run not found");
  });

  it("returns the run with its artifacts and events", async () => {
    const run = makeRun();
    const artifacts = [{ id: "a1" }];
    const events = [{ id: "e1" }];
    const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockArtifactRepo.findByRunId.mockResolvedValue(artifacts);
    mockEventRepo.findByRunId.mockResolvedValue(events);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual(artifacts);
    expect(body.events).toEqual(events);
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

  it("returns the run's artifacts", async () => {
    const { app, mockArtifactRepo } = await buildApp();
    mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "a1", type: "Plan" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json().artifacts).toEqual([{ id: "a1", type: "Plan" }]);
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

  it("returns the run's events", async () => {
    const { app, mockEventRepo } = await buildApp();
    mockEventRepo.findByRunId.mockResolvedValue([{ id: "e1", eventType: "PLAN_CREATED" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([{ id: "e1", eventType: "PLAN_CREATED" }]);
  });
});

describe("GET /api/runs/:id/skills — agentSkillRepo missing", () => {
  it("skips injected-skill lookup when agentSkillRepo is unavailable", async () => {
    const { app, mockOrchestrator, mockEventRepo } = await buildApp();
    (mockOrchestrator.getAgentSkillRepo as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    mockEventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json().injectedSkills).toEqual([]);
  });

  it("returns 400 when the run id path segment is empty", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/runs//skills" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("runId is required");
  });

  it("defaults to no skillIds when the injection event payload omits the field", async () => {
    const { app, mockEventRepo } = await buildApp();
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
  });

  it("defaults shouldPersist/reason when the distillation event payload omits them", async () => {
    const { app, mockEventRepo } = await buildApp();
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
    expect(body.distillationDecision).toMatchObject({ shouldPersist: false, reason: "" });
  });
});

describe("POST /api/runs/:id/chat — working directory fallback", () => {
  const worktreeParent = mkdtempSync(join(tmpdir(), "routes-chat-fallback-"));

  it("falls back to the parent repo directory when the worktree path was removed", async () => {
    const run = makeRun({
      workingDirectory: join(worktreeParent, ".worktrees", "run-1"),
    });
    const claudeCodeRunner = {
      chatRun: vi.fn().mockResolvedValue({ text: "ok", durationMs: 10 }),
    };
    const { app, mockRunRepo } = await buildApp({
      options: { claudeCodeRunner: claudeCodeRunner as never },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(claudeCodeRunner.chatRun).toHaveBeenCalledOnce();
    const [input] = claudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(worktreeParent);
  });

  it("returns 422 when neither the worktree nor the fallback directory exist", async () => {
    const run = makeRun({
      workingDirectory: "/nonexistent/path/.worktrees/run-1",
    });
    const claudeCodeRunner = { chatRun: vi.fn() };
    const { app, mockRunRepo } = await buildApp({
      options: { claudeCodeRunner: claudeCodeRunner as never },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(claudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 500 when chatRun rejects with a non-Error value", async () => {
    const run = makeRun({ workingDirectory: worktreeParent });
    const claudeCodeRunner = { chatRun: vi.fn().mockRejectedValue("boom") };
    const { app, mockRunRepo } = await buildApp({
      options: { claudeCodeRunner: claudeCodeRunner as never },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(500);
  });
});

describe("POST /api/runs/:id/actions/approve-plan", () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(mockOrchestrator.runExecution).toHaveBeenCalledWith(run.id, { note: "looks good" });
  });

  it("truncates an overly long note and drops non-string notes", async () => {
    const { app, mockOrchestrator } = await buildApp();
    const longNote = "x".repeat(5000);

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: longNote },
    });
    const [, firstArg] = mockOrchestrator.approvePlan.mock.calls[0] as [string, { note?: string }];
    expect(firstArg.note).toHaveLength(4000);

    mockOrchestrator.approvePlan.mockClear();
    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: 42 },
    });
    const [, secondArg] = mockOrchestrator.approvePlan.mock.calls[0] as [
      string,
      { note?: string },
    ];
    expect(secondArg.note).toBeUndefined();
  });

  it("does not fail the request when the fire-and-forget execution rejects", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue(new Error("execution kaboom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it("does not fail the request when the fire-and-forget execution rejects with a non-Error", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(run);
    mockOrchestrator.runExecution.mockRejectedValue("non-error rejection");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 400 when approvePlan rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue(new Error("Plan not awaiting approval"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Plan not awaiting approval");
  });

  it("returns 400 with the stringified value when approvePlan rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue("not an Error instance");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not an Error instance");
  });

  it("treats a whitespace-only note the same as no note", async () => {
    const { app, mockOrchestrator } = await buildApp();

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    const [, arg] = mockOrchestrator.approvePlan.mock.calls[0] as [string, { note?: string }];
    expect(arg.note).toBeUndefined();
  });
});

describe("POST /api/runs/:id/actions/reject-plan — additional branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for an unrecognised mode", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("mode must be one of");
  });

  it("accepts mode 'fresh' explicitly", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh", context: "start over" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith(
      "run-1",
      "start over",
      "api",
      "fresh",
    );
  });

  it("returns 400 with the stringified value when rejectPlan throws a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockRejectedValue("some string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("some string failure");
  });
});

describe("POST /api/runs/:id/actions/re-review-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("kicks off a manual re-review and returns ok immediately", async () => {
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

  it("does not fail when the fire-and-forget re-review rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it("does not fail when the fire-and-forget re-review rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockRejectedValue("non-error rejection");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 400 when triggering the re-review throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("cannot start re-review");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot start re-review");
  });

  it("returns 400 with the stringified value when triggering the re-review throws a non-Error synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw "sync non-error";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("sync non-error");
  });
});

describe("POST /api/runs/:id/actions/revise-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("kicks off a manual plan revision and returns ok immediately", async () => {
    const { app, mockOrchestrator } = await buildApp();

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

  it("does not fail when the fire-and-forget revision rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue(new Error("boom"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it("does not fail when the fire-and-forget revision rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockRejectedValue("non-error rejection");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 400 when triggering the revision throws synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("cannot start revision");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot start revision");
  });

  it("returns 400 with the stringified value when triggering the revision throws a non-Error synchronously", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw "sync non-error";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("sync non-error");
  });
});

describe("POST /api/runs/:id/actions/approve-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 and the new state on success", async () => {
    const run = makeRun({ state: RunState.Done });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: RunState.Done });
  });

  it("returns 400 when approveHumanReview rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("not in review"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not in review");
  });

  it("returns 400 with the stringified value when approveHumanReview rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue("non-error rejection");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-review",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("non-error rejection");
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

  it("sends the pause-ai command for the run's linear issue", async () => {
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

  it("returns 400 when handleCommand rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot pause"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot pause");
  });

  it("returns 400 with the stringified value when handleCommand rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.handleCommand.mockRejectedValue("non-error rejection");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("non-error rejection");
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

  it("sends the resume-ai command for the run's linear issue", async () => {
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

  it("returns 400 when handleCommand rejects", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.handleCommand.mockRejectedValue(new Error("cannot resume"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("cannot resume");
  });

  it("returns 400 with the stringified value when handleCommand rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.handleCommand.mockRejectedValue("non-error rejection");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("non-error rejection");
  });
});

describe("POST /api/runs/:id/actions/answer-questions — additional branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 with the message for a generic Error thrown by the orchestrator", async () => {
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

  it("returns 400 with the stringified value for a non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("plain string failure");
  });

  it("re-confirms PolicyError and ValidationError mapping still works via this file's setup", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValueOnce(new PolicyError("wrong state"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(409);

    mockOrchestrator.answerQuestions.mockRejectedValueOnce(new ValidationError("bad input"));
    const res2 = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });
    expect(res2.statusCode).toBe(400);
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

  it("returns 400 for a state that cannot be retried", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

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
    it(`triggers orchestrator.${method}() for state ${state} and returns retrying:true`, async () => {
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

  it("does not fail the request when the fire-and-forget retry trigger rejects", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue(new Error("retry blew up"));

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
  });

  it("does not fail the request when the fire-and-forget retry trigger rejects with a non-Error", async () => {
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
    mockOrchestrator.retryRun.mockRejectedValue("non-error rejection");

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

    expect(res.statusCode).toBe(200);
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

  it("returns a fully-null summary when no artifacts exist yet", async () => {
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

  it("returns a fully-populated summary with risks of mixed shapes", async () => {
    const run = makeRun();
    const circularRisk: Record<string, unknown> = { description: undefined };
    circularRisk.self = circularRisk; // forces JSON.stringify to throw for the fallback risk

    const { app, mockArtifactRepo } = await buildApp();
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "plan-1",
          version: 2,
          payloadJson: {
            summary: "Add middleware",
            confidence: 0.8,
            openQuestions: [{ id: "q1", question: "Which lib?", requiredForExecution: true }],
            steps: [{ id: "s1", title: "Step 1", description: "Do thing" }],
            risks: ["plain string risk", { description: "object risk" }, circularRisk],
            testPlan: "Run unit tests",
          },
        });
      }
      if (type === "PlanReview") {
        return Promise.resolve({ id: "pr-1", version: 1, payloadJson: { approved: true } });
      }
      if (type === "Review") {
        return Promise.resolve({ id: "rv-1", version: 1, payloadJson: { verdict: "pass" } });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "ex-1",
          version: 3,
          payloadJson: { executionVersion: 3, score: 0.9, scoreRationale: "solid" },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.summary).toBe("Add middleware");
    expect(body.plan.stepCount).toBe(1);
    expect(body.plan.riskCount).toBe(3);
    expect(body.plan.risks[0]).toBe("plain string risk");
    expect(body.plan.risks[1]).toBe("object risk");
    expect(typeof body.plan.risks[2]).toBe("string");
    expect(body.planReview.payload).toEqual({ approved: true });
    expect(body.review.payload).toEqual({ verdict: "pass" });
    expect(body.executionReport.executionVersion).toBe(3);
    expect(body.executionReport.score).toBe(0.9);
    expect(run.id).toBe("run-1");
  });

  it("defaults openQuestions and steps when the plan payload omits them", async () => {
    const { app, mockArtifactRepo } = await buildApp();
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "plan-1",
          version: 1,
          payloadJson: { summary: "No questions or steps listed" },
        });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.openQuestions).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
    expect(body.plan.steps).toEqual([]);
  });

  it("falls back to artifact version when the execution report payload has no executionVersion", async () => {
    const { app, mockArtifactRepo } = await buildApp();
    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({ id: "ex-1", version: 7, payloadJson: null });
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executionReport.executionVersion).toBe(7);
    expect(body.executionReport.score).toBeUndefined();
  });
});

describe("POST /api/runs/:id/actions/request-human — additional branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("uses default debounceHours and uiBaseUrl when options are not provided", async () => {
    const run = makeRun({ linearIssueIdentifier: null });
    const { app, mockRunRepo } = await buildApp({ options: {} });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "needs a human" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.debounced).toBe(false);
    // No notificationService configured => both channels false.
    expect(body.notified).toEqual({ slack: false, email: false });
  });

  it("does not debounce when the prior matching event is outside the debounce window", async () => {
    const run = makeRun();
    const oldTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, default window is 6h
    const { app, mockRunRepo, mockEventRepo } = await buildApp({ options: {} });
    mockRunRepo.findById.mockResolvedValue(run);
    mockEventRepo.findByRunId.mockResolvedValue([
      { eventType: RunEvent.HUMAN_REQUESTED, createdAt: oldTs, payloadJson: { reason: "other" } },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "still needs a human" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
  });

  it("ignores unrelated event types when checking for a debounce match", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);
    mockEventRepo.findByRunId.mockResolvedValue([
      { eventType: "PLAN_CREATED", createdAt: new Date(), payloadJson: { reason: "other" } },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "unrelated prior event" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
  });
});

describe("GET /api/processes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all active processes when no runId filter is given", async () => {
    const processes = [
      { id: "p1", pid: 1, command: "x", runId: "run-1", stage: "s", runtime: "r", startedAt: "t", elapsedMs: 1 },
      { id: "p2", pid: 2, command: "y", runId: "run-2", stage: "s", runtime: "r", startedAt: "t", elapsedMs: 1 },
    ];
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json().processes).toHaveLength(2);
  });

  it("filters by runId when provided", async () => {
    const processes = [
      { id: "p1", pid: 1, command: "x", runId: "run-1", stage: "s", runtime: "r", startedAt: "t", elapsedMs: 1 },
      { id: "p2", pid: 2, command: "y", runId: "run-2", stage: "s", runtime: "r", startedAt: "t", elapsedMs: 1 },
    ];
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.processes).toHaveLength(1);
    expect(body.processes[0].id).toBe("p2");
  });
});

describe("GET /api/processes/:id/output", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when there is no output for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

    expect(res.statusCode).toBe(404);
  });

  it("returns the buffered output for the process", async () => {
    const { app, mockProcessRunner } = await buildApp();
    mockProcessRunner.getProcessOutput.mockReturnValue("some stdout");

    const res = await app.inject({ method: "GET", url: "/api/processes/proc-1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "proc-1", output: "some stdout" });
  });
});

describe("GET /api/linear/pending", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(501);
  });

  it("returns the discovered issues on success", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockResolvedValue([{ id: "LIN-9" }]),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(200);
    expect(res.json().issues).toEqual([{ id: "LIN-9" }]);
  });

  it("returns 500 when discovery throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue(new Error("linear api down")),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("linear api down");
  });

  it("returns 500 with the stringified value when discovery rejects with a non-Error", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn().mockRejectedValue("non-error rejection"),
      startRunsForIssues: vi.fn(),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("non-error rejection");
  });
});

describe("POST /api/linear/ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 501 when no linearPollService is configured", async () => {
    const { app } = await buildApp({ linearPollService: undefined });

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
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns the started/skipped result on success", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockResolvedValue({ started: ["LIN-1"], skipped: [] }),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, started: ["LIN-1"], skipped: [] });
  });

  it("returns 500 when startRunsForIssues throws", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockRejectedValue(new Error("ingest blew up")),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("ingest blew up");
  });

  it("returns 500 with the stringified value when startRunsForIssues rejects with a non-Error", async () => {
    const linearPollService = {
      discoverPendingIssues: vi.fn(),
      startRunsForIssues: vi.fn().mockRejectedValue("non-error rejection"),
    };
    const { app } = await buildApp({ linearPollService });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("non-error rejection");
  });
});

describe("GET /api/events/stream", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("writes SSE headers, forwards dashboard events, and cleans up listeners on client disconnect", async () => {
    const dashboardListeners: Array<(event: unknown) => void> = [];
    const mockEmitter = {
      on: vi.fn((_event: string, handler: (event: unknown) => void) => {
        dashboardListeners.push(handler);
      }),
      off: vi.fn((_event: string, handler: (event: unknown) => void) => {
        const idx = dashboardListeners.indexOf(handler);
        if (idx !== -1) dashboardListeners.splice(idx, 1);
      }),
    };

    const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
    const mockArtifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
    const mockEventRepo = { findByRunId: vi.fn() };
    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => mockArtifactRepo,
      getEventRepo: () => mockEventRepo,
      getAgentSkillRepo: vi.fn(),
    };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };

    app = Fastify({ logger: false });
    registerApiRoutes(
      app,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );
    await app.listen({ port: 0, host: "127.0.0.1" });

    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const chunks: Buffer[] = [];
    let headers: http.IncomingHttpHeaders = {};
    const clientReq = http.get(
      { host: "127.0.0.1", port, path: "/api/events/stream" },
      (res) => {
        headers = res.headers;
        res.on("data", (c: Buffer) => chunks.push(c));
      },
    );
    clientReq.on("error", () => {
      // Expected once we destroy the client below.
    });

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(headers["content-type"]).toBe("text/event-stream");
    expect(headers["cache-control"]).toBe("no-cache");
    expect(Buffer.concat(chunks).toString()).toContain(":\n\n");
    expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));
    expect(dashboardListeners).toHaveLength(1);

    const dashboardEvent = {
      type: "run:created",
      runId: "run-1",
      issueId: "LIN-1",
      repo: "org/repo",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    dashboardListeners[0](dashboardEvent);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(Buffer.concat(chunks).toString()).toContain(JSON.stringify(dashboardEvent));

    clientReq.destroy();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", expect.any(Function));
    expect(dashboardListeners).toHaveLength(0);
  }, 10_000);
});
