import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// These tests exercise the chat route's working-directory fallback logic:
// when run.workingDirectory no longer exists on disk (e.g. its worktree was
// cleaned up), the route tries to fall back to the main repo directory by
// stripping a trailing "/.worktrees/..." segment.

function makeRun(workingDirectory: string) {
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
    workingDirectory,
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
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
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockClaudeCodeRunner = {
    chatRun: vi.fn().mockResolvedValue({ text: "Assistant reply", durationMs: 100 }),
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
  return { app, mockRunRepo, mockClaudeCodeRunner };
}

describe("POST /api/runs/:id/chat — workingDirectory fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 422 when workingDirectory is missing and has no '.worktrees' segment", async () => {
    const missingDir = join(tmpdir(), "definitely-does-not-exist-" + Math.random());
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(missingDir));

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

  it("falls back to the main repo dir when workingDirectory is under a missing '.worktrees' path and the parent exists", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "chat-fallback-parent-"));
    const missingWorktreeDir = join(parentDir, ".worktrees", "run-1-worktree");
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(missingWorktreeDir));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockClaudeCodeRunner.chatRun).toHaveBeenCalledOnce();
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(parentDir);
  });

  it("returns 422 when both the worktree dir and its fallback parent are missing", async () => {
    const missingParent = join(tmpdir(), "missing-parent-" + Math.random());
    const missingWorktreeDir = join(missingParent, ".worktrees", "run-1-worktree");
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(missingWorktreeDir));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 500 with a generic message when chatRun rejects with a non-Error value", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "chat-nonerror-"));
    const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() };
    const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
    const mockOrchestrator = {
      getRunRepo: () => ({ findById: vi.fn().mockResolvedValue(makeRun(workingDir)) }),
      getArtifactRepo: () => mockArtifactRepo,
      getEventRepo: () => mockEventRepo,
    };
    const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
    const mockProcessRunner = {
      getActiveProcesses: vi.fn().mockReturnValue([]),
      getProcessOutput: vi.fn().mockReturnValue(null),
    };
    const runnerRejectingString = { chatRun: vi.fn().mockRejectedValue("subprocess crashed") };

    const app = Fastify({ logger: false });
    registerApiRoutes(
      app,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
      undefined,
      { claudeCodeRunner: runnerRejectingString as never },
    );
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Chat request failed" });
    expect(mockArtifactRepo.create).not.toHaveBeenCalled();
  });
});
