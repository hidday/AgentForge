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
    linearIssueDescription: "Test description",
    linearIssueTitle: "Test issue",
    linearIssueUrl: null,
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

async function buildApp() {
  const mockRunRepo = {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(makeRun()),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
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
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    getLinearClient: vi.fn(),
  };

  const mockLinearPollService = {
    discoverPendingIssues: vi.fn().mockResolvedValue([]),
    startRunsForIssues: vi.fn().mockResolvedValue({ started: [], skipped: [] }),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
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
    mockLinearPollService as never,
  );
  await app.ready();

  return { app, mockRunRepo, mockOrchestrator, mockLinearPollService };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("non-Error rejection branches across action routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approve-plan: stringifies a non-Error thrown by orchestrator.approvePlan", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockRejectedValue("plain string failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "plain string failure" });
  });

  it("approve-review: stringifies a non-Error thrown by orchestrator.approveHumanReview", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approveHumanReview.mockRejectedValue({ code: "E_FAIL" });

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/approve-review" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "[object Object]" });
  });

  it("pause: stringifies a non-Error thrown by handleCommand", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.handleCommand.mockRejectedValue(42);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "42" });
  });

  it("resume: stringifies a non-Error thrown by handleCommand", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.handleCommand.mockRejectedValue(null);

    const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "null" });
  });

  it("reject-plan: returns 400 for an invalid mode value", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus" },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("mode must be one of");
  });

  it("reject-plan: stringifies a non-Error thrown by orchestrator.rejectPlan", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockRejectedValue("nope");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: "feedback" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "nope" });
  });

  it("answer-questions: returns 400 with a stringified message for a generic Error (not Policy/Validation)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new Error("unexpected orchestrator failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "unexpected orchestrator failure" });
  });

  it("answer-questions: returns 400 with a stringified non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue("weird failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "weird failure" });
  });

  it("/api/linear/pending: stringifies a non-Error rejection", async () => {
    const { app, mockLinearPollService } = await buildApp();
    mockLinearPollService.discoverPendingIssues.mockRejectedValue("linear unreachable");

    const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "linear unreachable" });
  });

  it("/api/linear/ingest: stringifies a non-Error rejection", async () => {
    const { app, mockLinearPollService } = await buildApp();
    mockLinearPollService.startRunsForIssues.mockRejectedValue("ingest failed");

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/ingest",
      payload: { issueIds: ["LIN-1"] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "ingest failed" });
  });
});

describe("re-review-plan / revise-plan synchronous-throw catch branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-review-plan: returns 400 when orchestrator.runManualReReview throws synchronously (Error)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw new Error("sync failure");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync failure" });
  });

  it("re-review-plan: returns 400 with a stringified non-Error synchronous throw", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualReReview.mockImplementation(() => {
      throw "sync string failure";
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync string failure" });
  });

  it("revise-plan: returns 400 when orchestrator.runManualPlanRevision throws synchronously (Error)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw new Error("sync revise failure");
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "sync revise failure" });
  });

  it("revise-plan: returns 400 with a stringified non-Error synchronous throw", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.runManualPlanRevision.mockImplementation(() => {
      throw { weird: true };
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "[object Object]" });
  });

  it("approve-plan: does not throw an unhandled rejection when the background runExecution rejects with a non-Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockRejectedValue("background non-error failure");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await flush();
  });
});

describe("sanitizeNote edge cases (via approve-plan)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats a whitespace-only note as absent (undefined)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockResolvedValue(makeRun());

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: "   " },
    });

    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });

  it("treats a non-string note as absent (undefined)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockResolvedValue(makeRun());

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: 12345 },
    });

    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });

  it("truncates an overly long note to MAX_OPERATOR_NOTE_LENGTH (4000 chars)", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockResolvedValue(makeRun());
    const longNote = "x".repeat(5000);

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: { note: longNote },
    });

    const call = mockOrchestrator.approvePlan.mock.calls[0][1] as { note: string };
    expect(call.note).toHaveLength(4000);
  });

  it("omits the note entirely when the body has no note field at all", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.approvePlan.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    mockOrchestrator.runExecution.mockResolvedValue(makeRun());

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/approve-plan",
      payload: {},
    });

    expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: undefined });
  });
});

describe("POST /api/runs/:id/chat -- workingDirectory fallback branches", () => {
  it("falls back to the pre-worktree repo directory when the worktree path no longer exists", async () => {
    const mainRepoDir = mkdtempSync(join(tmpdir(), "routes-chat-fallback-"));
    const staleWorktreePath = join(mainRepoDir, ".worktrees", "run-1-stale");

    const mockRunRepo = {
      findById: vi.fn().mockResolvedValue(
        makeRun({ workingDirectory: staleWorktreePath, state: RunState.Implementing }),
      ),
      findAll: vi.fn(),
    };
    const mockArtifactRepo = {
      findByRunId: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((params) => ({ id: "a1", ...params, createdAt: new Date() })),
    };
    const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
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
      getLinearClient: vi.fn(),
    };
    const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };
    const mockClaudeCodeRunner = {
      chatRun: vi.fn().mockResolvedValue({ text: "reply", durationMs: 10 }),
    };

    const app = Fastify({ logger: false });
    registerApiRoutes(
      app,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
      undefined,
      { claudeCodeRunner: mockClaudeCodeRunner as never },
    );
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockClaudeCodeRunner.chatRun).toHaveBeenCalledOnce();
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(mainRepoDir);
  });

  it("returns 422 when neither the worktree path nor the fallback main repo path exist", async () => {
    const mockRunRepo = {
      findById: vi.fn().mockResolvedValue(
        makeRun({
          workingDirectory: "/definitely/does/not/exist/.worktrees/run-1",
          state: RunState.Implementing,
        }),
      ),
      findAll: vi.fn(),
    };
    const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() };
    const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
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
      getLinearClient: vi.fn(),
    };
    const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };
    const mockClaudeCodeRunner = { chatRun: vi.fn() };

    const app = Fastify({ logger: false });
    registerApiRoutes(
      app,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
      undefined,
      { claudeCodeRunner: mockClaudeCodeRunner as never },
    );
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 500 with a stringified message when chatRun rejects with a non-Error", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "routes-chat-nonerror-"));
    const mockRunRepo = {
      findById: vi.fn().mockResolvedValue(
        makeRun({ workingDirectory: workspaceDir, state: RunState.Implementing }),
      ),
      findAll: vi.fn(),
    };
    const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() };
    const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
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
      getLinearClient: vi.fn(),
    };
    const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };
    const mockClaudeCodeRunner = { chatRun: vi.fn().mockRejectedValue("subprocess crashed") };

    const app = Fastify({ logger: false });
    registerApiRoutes(
      app,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
      undefined,
      { claudeCodeRunner: mockClaudeCodeRunner as never },
    );
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(500);
  });
});
