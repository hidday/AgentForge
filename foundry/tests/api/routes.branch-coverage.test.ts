import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Add feature",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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

async function buildApp(opts: {
  orchestratorOverrides?: Record<string, unknown>;
  run?: unknown | null;
  events?: unknown[];
  skills?: Record<string, unknown>;
  registerOptions?: Record<string, unknown>;
} = {}) {
  const mockRunRepo = {
    findById: vi.fn().mockResolvedValue(opts.run === undefined ? makeRun() : opts.run),
    findAll: vi.fn(),
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
    findByRunId: vi.fn().mockResolvedValue(opts.events ?? []),
    create: vi.fn().mockResolvedValue({}),
  };

  const skillsMap = opts.skills ?? {};
  const mockAgentSkillRepo = {
    findById: vi.fn().mockImplementation((id: string) => Promise.resolve(skillsMap[id] ?? null)),
    findByRepoCategoryNearTime: vi.fn().mockResolvedValue(null),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(mockAgentSkillRepo),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runExecution: vi.fn().mockResolvedValue(undefined),
    runManualReReview: vi.fn().mockResolvedValue(undefined),
    runManualPlanRevision: vi.fn().mockResolvedValue(undefined),
    retryRun: vi.fn().mockResolvedValue(undefined),
    runPlanning: vi.fn().mockResolvedValue(undefined),
    runPlanRevision: vi.fn().mockResolvedValue(undefined),
    runPlanReview: vi.fn().mockResolvedValue(undefined),
    runReview: vi.fn().mockResolvedValue(undefined),
    runRemediation: vi.fn().mockResolvedValue(undefined),
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
    undefined,
    opts.registerOptions ?? {},
  );
  await app.ready();

  return { app, mockOrchestrator, mockRunRepo, mockEventRepo, mockAgentSkillRepo };
}

describe("non-Error rejection branches (err instanceof Error ? ... : String(err))", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approve-plan surfaces String(err) when the orchestrator throws a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue("plain string failure");

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "plain string failure" });
  });

  it("pause surfaces String(err) when handleCommand throws a non-Error value", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.handleCommand.mockRejectedValue({ code: "boom" });

    const response = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "[object Object]" });
  });
});

describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when mode is not one of the valid values", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
  });

  it("accepts mode 'fresh' and forwards it to the orchestrator", async () => {
    const run = makeRun();
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "fresh" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith("run-1", undefined, "api", "fresh");
  });
});

describe("GET /api/runs/:id/skills — nullish-coalescing fallbacks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back to an empty skillIds array when the injection payload omits it", async () => {
    const events = [
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date(),
      },
    ];
    const { app, mockAgentSkillRepo } = await buildApp({ events });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ injectedSkills: [] });
    expect(mockAgentSkillRepo.findById).not.toHaveBeenCalled();
  });

  it("defaults shouldPersist to false and reason to '' when the distillation payload omits them", async () => {
    const events = [
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_DISTILLATION",
        source: "distillation-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ];
    const { app } = await buildApp({ events });

    const response = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      distillationDecision: { shouldPersist: boolean; reason: string; taskCategory: null };
    };
    expect(body.distillationDecision).toMatchObject({
      shouldPersist: false,
      reason: "",
      taskCategory: null,
    });
  });
});

describe("POST /api/runs/:id/chat — worktree fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back to the base repo dir when the worktree path is gone and it exists", async () => {
    const baseRepoDir = mkdtempSync(join(tmpdir(), "chat-fallback-base-"));
    const missingWorktree = join(baseRepoDir, ".worktrees", "run-1");
    // Note: missingWorktree is never created on disk, so existsSync(missingWorktree) is false,
    // but existsSync(baseRepoDir) (after stripping "/.worktrees/...") is true.

    const run = makeRun({ workingDirectory: missingWorktree });
    const mockClaudeCodeRunner = {
      chatRun: vi.fn().mockResolvedValue({ text: "reply", durationMs: 10 }),
    };
    const { app } = await buildApp({
      run,
      registerOptions: { claudeCodeRunner: mockClaudeCodeRunner },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockClaudeCodeRunner.chatRun).toHaveBeenCalledOnce();
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(baseRepoDir);
  });

  it("returns 422 when neither the worktree nor the fallback base dir exist", async () => {
    const run = makeRun({
      workingDirectory: join("/definitely/not/a/real/path", ".worktrees", "run-1"),
    });
    const mockClaudeCodeRunner = { chatRun: vi.fn() };
    const { app } = await buildApp({
      run,
      registerOptions: { claudeCodeRunner: mockClaudeCodeRunner },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 422 when the workingDirectory has no /.worktrees/ segment and does not exist", async () => {
    const run = makeRun({ workingDirectory: "/definitely/not/a/real/path" });
    const mockClaudeCodeRunner = { chatRun: vi.fn() };
    const { app } = await buildApp({
      run,
      registerOptions: { claudeCodeRunner: mockClaudeCodeRunner },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/request-human — remaining branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildApp({ run: null });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "hi" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Run not found" });
  });

  it("uses default debounceHours (6) and default uiBaseUrl when options are omitted", async () => {
    const run = makeRun({ linearIssueIdentifier: null });
    const notificationService = {
      isConfigured: () => true,
      sendHumanRequest: vi.fn().mockResolvedValue({
        slack: { attempted: true, ok: true },
        email: { attempted: false, ok: false },
      }),
    };
    const { app } = await buildApp({
      run,
      registerOptions: { notificationService },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Needs a human" },
    });

    expect(response.statusCode).toBe(200);
    const payload = notificationService.sendHumanRequest.mock.calls[0][0] as {
      runUrl: string;
      linearIssue: { identifier?: string };
    };
    // Default uiBaseUrl is http://localhost:5173
    expect(payload.runUrl).toBe("http://localhost:5173/runs/run-1");
    // null linearIssueIdentifier is coalesced to undefined
    expect(payload.linearIssue.identifier).toBeUndefined();
  });
});
