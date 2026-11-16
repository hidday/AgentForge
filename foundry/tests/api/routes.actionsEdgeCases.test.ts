import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
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

async function buildApp(opts: { withRunner?: boolean } = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() };
  const mockEventRepo = { findByRunId: vi.fn() };

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

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockClaudeCodeRunner =
    opts.withRunner === false
      ? undefined
      : { chatRun: vi.fn().mockResolvedValue({ text: "ok", durationMs: 1 }) };

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
  return { app, mockRunRepo, mockOrchestrator };
}

describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when mode is not 'iterate' or 'fresh'", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
  });

  it("passes mode 'fresh' through to orchestrator.rejectPlan", async () => {
    const run = makeRun({ state: RunState.Todo });
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.rejectPlan.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { context: "start over", mode: "fresh" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.rejectPlan).toHaveBeenCalledWith(
      "run-1",
      "start over",
      "api",
      "fresh",
    );
  });
});

describe("POST /api/runs/:id/actions/answer-questions — generic error branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 with the message when orchestrator throws a plain Error", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue(new Error("Unexpected failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unexpected failure" });
  });

  it("returns 400 with a stringified error for a non-Error rejection", async () => {
    const { app, mockOrchestrator } = await buildApp();
    mockOrchestrator.answerQuestions.mockRejectedValue("totally broken");

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/answer-questions",
      payload: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "totally broken" });
  });
});

describe("POST /api/runs/:id/chat — working directory fallback/missing branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 422 when neither the working directory nor its worktree-stripped parent exist", async () => {
    const run = makeRun({ workingDirectory: "/definitely/does/not/exist/anywhere" });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
  });

  it("falls back to the repo root when the workingDirectory is a cleaned-up worktree", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "routes-chat-fallback-"));
    try {
      const run = makeRun({ workingDirectory: join(repoRoot, ".worktrees", "run-1") });
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      void mockOrchestrator;

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "hello" },
      });

      // The worktree path itself doesn't exist, but its parent (repoRoot) does,
      // so the route should fall back to it and succeed rather than 422.
      expect(res.statusCode).toBe(200);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
