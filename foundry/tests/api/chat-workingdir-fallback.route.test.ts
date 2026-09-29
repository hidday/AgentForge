import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// The chat route falls back from a cleaned-up worktree directory to the main
// repo directory (by stripping the "/.worktrees/<name>" suffix) before
// spawning the chat subprocess. These tests exercise that fallback logic,
// which routes.chat.test.ts does not cover.

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
    state: RunState.Done,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory,
    latestArtifactVersion: 3,
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
    chatRun: vi.fn().mockResolvedValue({ text: "Assistant reply", durationMs: 5 }),
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

describe("POST /api/runs/:id/chat — working directory fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to the main repo dir when the worktree was cleaned up, and it exists", async () => {
    const mainRepoDir = mkdtempSync(join(tmpdir(), "chat-fallback-main-"));
    const missingWorktreeDir = join(mainRepoDir, ".worktrees", "ENG-42-some-branch");
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
    expect(input.workingDirectory).toBe(mainRepoDir);
  });

  it("returns 422 when neither the worktree nor its fallback main repo dir exist", async () => {
    const missingMainRepoDir = join(tmpdir(), "does-not-exist-" + Math.random().toString(36));
    const missingWorktreeDir = join(missingMainRepoDir, ".worktrees", "ENG-42-some-branch");
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(missingWorktreeDir));

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

  it("returns 422 when the working directory is missing and has no /.worktrees/ segment", async () => {
    const missingDir = join(tmpdir(), "totally-missing-" + Math.random().toString(36));
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(missingDir));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });
});
