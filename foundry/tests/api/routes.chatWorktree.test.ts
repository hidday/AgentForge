import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Covers the chat route's working-directory fallback logic: when the run's
// recorded workingDirectory no longer exists on disk (e.g. a cleaned-up
// worktree), the route tries to fall back to the parent repo directory
// (everything before "/.worktrees/"), and returns 422 if that doesn't exist
// either.

function makeRun(workingDirectory: string) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
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
    workingDirectory,
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function buildApp(
  run: ReturnType<typeof makeRun>,
  opts: { chatRunRejection?: unknown } = {},
) {
  const mockRunRepo = { findById: vi.fn().mockResolvedValue(run), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
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
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockClaudeCodeRunner = {
    chatRun:
      "chatRunRejection" in opts
        ? vi.fn().mockRejectedValue(opts.chatRunRejection)
        : vi.fn().mockResolvedValue({ text: "Assistant reply", durationMs: 10 }),
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

  return { app, mockClaudeCodeRunner };
}

describe("POST /api/runs/:id/chat — workingDirectory fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 422 when workingDirectory is missing and has no /.worktrees/ segment", async () => {
    const run = makeRun("/definitely/does/not/exist/anywhere");
    const { app, mockClaudeCodeRunner } = await buildApp(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 422 when the /.worktrees/ fallback base also doesn't exist", async () => {
    const run = makeRun("/definitely/does/not/exist/.worktrees/run-1");
    const { app, mockClaudeCodeRunner } = await buildApp(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("falls back to the repo root when the worktree is gone but the repo root exists", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "routes-chat-fallback-"));
    const run = makeRun(join(repoRoot, ".worktrees", "run-1"));
    const { app, mockClaudeCodeRunner } = await buildApp(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockClaudeCodeRunner.chatRun).toHaveBeenCalledOnce();
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(repoRoot);
  });

  it("returns 500 when chatRun rejects with a non-Error value", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "routes-chat-nonerror-"));
    const run = makeRun(repoRoot);
    const { app } = await buildApp(run, { chatRunRejection: "raw string failure" });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Chat request failed" });
  });
});
