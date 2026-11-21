import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes, type RegisterApiRoutesOptions } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Residual branch coverage for routes.ts not exercised by the per-route
// test files: chat worktree fallback, skills payload defaults,
// answer-questions generic errors and request-human defaults.

const repoDir = mkdtempSync(join(tmpdir(), "routes-edge-"));
afterAll(() => rmSync(repoDir, { recursive: true, force: true }));

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/i/LIN-1",
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: repoDir,
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function buildApp(options: RegisterApiRoutesOptions = {}) {
  const runRepo = { findById: vi.fn(), findAll: vi.fn() };
  const artifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
  };
  const eventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  };
  const agentSkillRepo = { findById: vi.fn(), findByRepoCategoryNearTime: vi.fn() };
  const orchestrator = {
    getRunRepo: () => runRepo,
    getArtifactRepo: () => artifactRepo,
    getEventRepo: () => eventRepo,
    getAgentSkillRepo: () => agentSkillRepo,
    answerQuestions: vi.fn(),
  };
  const emitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };

  const app = Fastify({ logger: false });
  const logError = vi.spyOn(app.log, "error");
  registerApiRoutes(app, orchestrator as never, emitter as never, {} as never, undefined, options);
  await app.ready();
  current = app;
  return { app, runRepo, artifactRepo, eventRepo, agentSkillRepo, orchestrator, emitter, logError };
}

let current: FastifyInstance | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe("POST /api/runs/:id/chat — working directory fallback", () => {
  function runner() {
    return { chatRun: vi.fn().mockResolvedValue({ text: "hi", durationMs: 5 }) };
  }

  it("falls back to the main repo dir when the run's worktree has been removed", async () => {
    const claudeCodeRunner = runner();
    const { app, runRepo } = await buildApp({ claudeCodeRunner: claudeCodeRunner as never });
    runRepo.findById.mockResolvedValue(
      makeRun({ workingDirectory: `${repoDir}/.worktrees/run-1` }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "what happened?" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: "hi", durationMs: 5 });
    expect(claudeCodeRunner.chatRun).toHaveBeenCalledWith(
      expect.objectContaining({ workingDirectory: repoDir, prompt: "what happened?" }),
      "chat",
    );
  });

  it("returns 422 when the worktree and its parent repo are both gone", async () => {
    const claudeCodeRunner = runner();
    const { app, runRepo, artifactRepo } = await buildApp({
      claudeCodeRunner: claudeCodeRunner as never,
    });
    runRepo.findById.mockResolvedValue(
      makeRun({ workingDirectory: join(repoDir, "deleted-repo", ".worktrees", "run-1") }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
    expect(claudeCodeRunner.chatRun).not.toHaveBeenCalled();
    expect(artifactRepo.create).not.toHaveBeenCalled();
  });

  it("returns 422 when a non-worktree directory is missing", async () => {
    const claudeCodeRunner = runner();
    const { app, runRepo } = await buildApp({ claudeCodeRunner: claudeCodeRunner as never });
    runRepo.findById.mockResolvedValue(makeRun({ workingDirectory: join(repoDir, "no-such-dir") }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(claudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("logs a stringified non-Error chat failure and returns 500", async () => {
    const claudeCodeRunner = { chatRun: vi.fn().mockRejectedValue("cli crashed") };
    const { app, runRepo, logError } = await buildApp({
      claudeCodeRunner: claudeCodeRunner as never,
    });
    runRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Chat request failed" });
    expect(logError).toHaveBeenCalledWith(
      { runId: "run-1", error: "cli crashed" },
      "Chat run failed",
    );
  });
});

describe("GET /api/runs/:id/skills — payload defaults", () => {
  it("returns 400 when the run id segment is empty", async () => {
    const { app, eventRepo } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/runs//skills" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "runId is required" });
    expect(eventRepo.findByRunId).not.toHaveBeenCalled();
  });

  it("tolerates injection events without skillIds and distillation events with empty payloads", async () => {
    const { app, eventRepo, agentSkillRepo } = await buildApp();
    eventRepo.findByRunId.mockResolvedValue([
      { eventType: "SKILL_INJECTION", payloadJson: {}, createdAt: new Date() },
      { eventType: "SKILL_DISTILLATION", payloadJson: {}, createdAt: new Date() },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      injectedSkills: [],
      distillationDecision: {
        shouldPersist: false,
        reason: "",
        taskCategory: null,
        name: null,
        description: null,
        displacedSkillId: null,
      },
      distilledSkill: null,
    });
    // No ids to resolve, and shouldPersist defaulted to false → no lookups.
    expect(agentSkillRepo.findById).not.toHaveBeenCalled();
    expect(agentSkillRepo.findByRepoCategoryNearTime).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/answer-questions — generic failures", () => {
  const payload = { answers: [{ questionId: "q1", answer: "Postgres" }] };

  it.each([
    [new Error("database exploded"), "database exploded"],
    ["plain string", "plain string"],
  ])("maps a non-policy/validation rejection (%s) to 400", async (err, expected) => {
    const { app, orchestrator } = await buildApp();
    orchestrator.answerQuestions.mockRejectedValue(err);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expected });
    expect(orchestrator.answerQuestions).toHaveBeenCalledWith("run-1", payload.answers);
  });

  it("rejects a non-object answer item", async () => {
    const { app, orchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [null] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("non-empty questionId");
    expect(orchestrator.answerQuestions).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/request-human — defaults", () => {
  const url = "/api/runs/run-1/actions/request-human";
  const payload = { reason: "plan_ambiguous", summary: "  need a human  " };

  it("returns 404 when the run is missing (after validating the body)", async () => {
    const { app, runRepo, eventRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "POST", url, payload });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
    expect(eventRepo.create).not.toHaveBeenCalled();
  });

  it("uses the default UI base URL and 6h debounce window, ignoring stale and unrelated events", async () => {
    const { app, runRepo, eventRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
    eventRepo.findByRunId.mockResolvedValue([
      // Same reason, but older than the default 6h window → not a debounce hit.
      {
        eventType: RunEvent.HUMAN_REQUESTED,
        createdAt: sevenHoursAgo,
        payloadJson: { reason: "plan_ambiguous" },
      },
      // Recent but a different event type → ignored.
      { eventType: "STATE_CHANGED", createdAt: new Date(), payloadJson: { reason: "plan_ambiguous" } },
    ]);

    const res = await app.inject({ method: "POST", url, payload });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      debounced: false,
      notified: { slack: false, email: false },
    });
    expect(eventRepo.create).toHaveBeenCalledWith({
      runId: "run-1",
      eventType: RunEvent.HUMAN_REQUESTED,
      source: "api",
      payloadJson: {
        reason: "plan_ambiguous",
        summary: "need a human",
        context: null,
        runUrl: "http://localhost:5173/runs/run-1",
        notified: { slack: false, email: false },
      },
    });
  });

  it("debounces within the default 6h window when no debounceHours option is set", async () => {
    const { app, runRepo, eventRepo } = await buildApp();
    runRepo.findById.mockResolvedValue(makeRun());
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    eventRepo.findByRunId.mockResolvedValue([
      {
        eventType: RunEvent.HUMAN_REQUESTED,
        createdAt: fiveHoursAgo,
        payloadJson: { reason: "plan_ambiguous" },
      },
    ]);

    const res = await app.inject({ method: "POST", url, payload });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, debounced: true });
    expect(eventRepo.create).not.toHaveBeenCalled();
  });

  it("strips a trailing slash from uiBaseUrl and omits a null Linear identifier", async () => {
    const notificationService = {
      isConfigured: vi.fn().mockReturnValue(true),
      sendHumanRequest: vi.fn().mockResolvedValue({
        slack: { attempted: true, ok: false },
        email: { attempted: true, ok: true },
      }),
    };
    const { app, runRepo } = await buildApp({
      uiBaseUrl: "https://forge.example.com/",
      notificationService: notificationService as never,
    });
    runRepo.findById.mockResolvedValue(makeRun({ linearIssueIdentifier: null }));

    const res = await app.inject({
      method: "POST",
      url,
      payload: { ...payload, context: "   " },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notified).toEqual({ slack: false, email: true });
    const sent = notificationService.sendHumanRequest.mock.calls[0][0];
    expect(sent.runUrl).toBe("https://forge.example.com/runs/run-1");
    expect(sent.linearIssue.identifier).toBeUndefined();
    expect(sent.context).toBeUndefined();
    expect(sent.planConfidence).toBeUndefined();
    expect(sent.openQuestions).toEqual([]);
  });
});
