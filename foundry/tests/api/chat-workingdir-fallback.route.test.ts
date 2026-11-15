import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// The chat route falls back from a worktree-nested workingDirectory to the
// main repo directory when the worktree has been cleaned up; if the main
// repo directory is also gone, it returns 422. These tests exercise both
// branches, which the happy-path chat tests (routes.chat.test.ts) don't hit.

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

async function buildApp(chatRunImpl?: () => Promise<{ text: string; durationMs: number }>) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]) };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockClaudeCodeRunner = {
    chatRun: vi.fn(chatRunImpl ?? (async () => ({ text: "ok", durationMs: 1 }))),
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
  let realRepoDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    realRepoDir = mkdtempSync(join(tmpdir(), "chat-fallback-repo-"));
  });

  it("falls back to the main repo dir when the worktree path is gone, and succeeds", async () => {
    const worktreePath = join(realRepoDir, ".worktrees", "run-1");
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(worktreePath));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(200);
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(realRepoDir);
  });

  it("returns 422 when neither the worktree nor the fallback repo dir exists", async () => {
    const { app, mockRunRepo } = await buildApp();
    const goneRepo = join(tmpdir(), "chat-fallback-does-not-exist");
    const goneWorktree = join(goneRepo, ".worktrees", "run-1");
    mockRunRepo.findById.mockResolvedValue(makeRun(goneWorktree));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
  });

  it("returns 422 when workingDirectory is gone and has no .worktrees segment to strip", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(
      makeRun(join(tmpdir(), "chat-fallback-plain-missing-dir")),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
  });

  it("cleanup: removes the temp repo dir", () => {
    rmSync(realRepoDir, { recursive: true, force: true });
  });
});
