import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Closes the handful of remaining gaps in routes.ts: the chat route's
// workingDirectory-missing fallback (both the ".worktrees" stripping success
// path and the still-missing-after-stripping 422 path), reject-plan's invalid
// `mode` validation branch, and the summary route's JSON.stringify-throws
// fallback (String(r)) for an unserializable risk entry.

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
    linearIssueUrl: null,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeArtifact(type: string, version: number, payloadJson: unknown) {
  return { id: `art-${type}`, runId: "run-1", type, version, payloadJson, createdAt: new Date() };
}

async function buildApp(opts: {
  withRunner?: boolean;
  runnerOverride?: Record<string, unknown>;
  orchestratorOverrides?: Record<string, unknown>;
} = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((params) => ({
      id: `artifact-${Math.random()}`,
      ...params,
      createdAt: new Date(),
    })),
  };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]) };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
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
    retryRun: vi.fn(),
    runManualReReview: vi.fn(),
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
    getLinearClient: vi.fn(),
    ...opts.orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };
  const mockClaudeCodeRunner =
    opts.withRunner !== false
      ? {
          chatRun: vi.fn().mockResolvedValue({ text: "Assistant reply", durationMs: 500 }),
          ...opts.runnerOverride,
        }
      : undefined;

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never, undefined, {
    claudeCodeRunner: mockClaudeCodeRunner as never,
  });

  await app.ready();
  return { app, mockRunRepo, mockArtifactRepo, mockOrchestrator, mockClaudeCodeRunner };
}

describe("POST /api/runs/:id/chat: workingDirectory fallback branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 422 when workingDirectory is missing and is not under .worktrees/", async () => {
    const run = makeRun({ workingDirectory: "/definitely/does/not/exist/anywhere" });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
  });

  it("falls back to the main repo path and succeeds when the worktree is gone but the main repo still exists", async () => {
    const mainRepoDir = mkdtempSync(join(tmpdir(), "routes-gaps-mainrepo-"));
    const run = makeRun({ workingDirectory: join(mainRepoDir, ".worktrees", "run-gone-xyz") });
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(200);
    const [input] = mockClaudeCodeRunner!.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(mainRepoDir);

    rmSync(mainRepoDir, { recursive: true, force: true });
  });

  it("returns 422 when the worktree is gone AND the stripped-down main repo path also doesn't exist", async () => {
    const run = makeRun({
      workingDirectory: "/definitely/gone/.worktrees/run-gone-xyz",
    });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
  });
});

describe("POST /api/runs/:id/actions/reject-plan: mode validation", () => {
  it("returns 400 with the valid-values list when mode is not 'iterate' or 'fresh'", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus-mode" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
    expect(mockOrchestrator.rejectPlan).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/request-human: additional branches", () => {
  function makeHumanRequestRun(overrides: Record<string, unknown> = {}) {
    return makeRun({
      linearIssueIdentifier: "LIN-1",
      linearIssueUrl: "https://linear.app/team/issue/LIN-1",
      ...overrides,
    });
  }

  async function buildRequestHumanApp(opts: {
    existingEvents?: { eventType: string; createdAt: Date; payloadJson: unknown }[];
    run?: ReturnType<typeof makeRun> | null;
    debounceHours?: number;
    uiBaseUrl?: string;
  } = {}) {
    const mockRunRepo = {
      findById: vi.fn().mockResolvedValue(opts.run === undefined ? makeHumanRequestRun() : opts.run),
      findAll: vi.fn(),
    };
    const mockArtifactRepo = {
      findByRunId: vi.fn().mockResolvedValue([]),
      findLatestByType: vi.fn().mockResolvedValue(null),
    };
    const mockEventRepo = {
      findByRunId: vi.fn().mockResolvedValue(opts.existingEvents ?? []),
      create: vi.fn().mockResolvedValue({}),
    };
    const mockOrchestrator = {
      getRunRepo: () => mockRunRepo,
      getArtifactRepo: () => mockArtifactRepo,
      getEventRepo: () => mockEventRepo,
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
    };
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };
    const sendHumanRequest = vi
      .fn()
      .mockResolvedValue({ slack: { attempted: true, ok: true }, email: { attempted: false, ok: false } });
    const notificationService = { isConfigured: () => true, sendHumanRequest };

    const app = Fastify({ logger: false });
    const options: Record<string, unknown> = { notificationService };
    if (opts.debounceHours !== undefined) options.debounceHours = opts.debounceHours;
    if (opts.uiBaseUrl !== undefined) options.uiBaseUrl = opts.uiBaseUrl;
    registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never, undefined, options);
    await app.ready();
    return { app, mockEventRepo, sendHumanRequest };
  }

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildRequestHumanApp({ run: null });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing-run/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Needs review" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("does not debounce on a prior HUMAN_REQUESTED event that is older than the debounce window", async () => {
    const staleTs = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10h ago, window is default 6h
    const { app, sendHumanRequest } = await buildRequestHumanApp({
      existingEvents: [
        { eventType: RunEvent.HUMAN_REQUESTED, createdAt: staleTs, payloadJson: { reason: "plan_ambiguous" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Same reason, but it's been a while" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("ignores events of a different eventType when checking for debounce", async () => {
    const recentTs = new Date(Date.now() - 60 * 1000);
    const { app, sendHumanRequest } = await buildRequestHumanApp({
      existingEvents: [
        { eventType: "SKILL_INJECTION", createdAt: recentTs, payloadJson: { reason: "plan_ambiguous" } },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Unrelated event type shouldn't debounce this" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().debounced).toBe(false);
    expect(sendHumanRequest).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default debounceHours (6) and uiBaseUrl when neither option is configured", async () => {
    const { app, sendHumanRequest } = await buildRequestHumanApp({});

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Uses default config values" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { runUrl: string };
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
  });

  it("sends linearIssue.identifier as undefined when the run has no identifier", async () => {
    const { app, sendHumanRequest } = await buildRequestHumanApp({
      run: makeHumanRequestRun({ linearIssueIdentifier: null }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "No identifier on this run" },
    });

    expect(res.statusCode).toBe(200);
    const payload = sendHumanRequest.mock.calls[0][0] as { linearIssue: { identifier?: string } };
    expect(payload.linearIssue.identifier).toBeUndefined();
  });
});

describe("GET /api/runs/:id/summary: unserializable risk entry", () => {
  it("falls back to String(r) when JSON.stringify throws on a risk entry (circular reference)", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: Record<string, unknown> = { note: "oops" };
    circular.self = circular;

    mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact("Plan", 1, { summary: "s", risks: [circular] }),
        );
      }
      return Promise.resolve(null);
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: { risks: string[] } };
    expect(body.plan.risks).toEqual([String(circular)]);
    expect(body.plan.risks[0]).toBe("[object Object]");
  });
});
