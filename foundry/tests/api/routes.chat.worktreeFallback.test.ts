import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// This file covers the chat route's fallback behaviour when a run's
// worktree directory has been cleaned up: it should fall back to the main
// repo directory (the part of the path before "/.worktrees/"), and only
// return 422 if that main repo directory is also missing.

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

  return { app, mockRunRepo, mockClaudeCodeRunner };
}

describe("POST /api/runs/:id/chat - worktree cleanup fallback", () => {
  let mainRepoDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mainRepoDir = mkdtempSync(join(tmpdir(), "chat-fallback-main-"));
  });

  afterEach(() => {
    rmSync(mainRepoDir, { recursive: true, force: true });
  });

  it("falls back to the main repo dir when the worktree path is gone, and still succeeds", async () => {
    const goneWorktree = join(mainRepoDir, ".worktrees", "run-1-feature");
    const run = makeRun(goneWorktree);
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Still there?" },
    });

    expect(res.statusCode).toBe(200);
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(mainRepoDir);
  });

  it("returns 422 when both the worktree and its main repo dir are missing", async () => {
    const neitherExists = join(mainRepoDir, "sub", ".worktrees", "run-1-feature");
    rmSync(mainRepoDir, { recursive: true, force: true }); // remove the main repo dir too
    const run = makeRun(neitherExists);
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello?" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
    // Recreate so afterEach's rmSync doesn't error on a missing path.
    mkdirSync(mainRepoDir, { recursive: true });
  });

  it("returns 422 when the working directory has no /.worktrees/ segment and doesn't exist", async () => {
    const run = makeRun("/definitely/does/not/exist/anywhere");
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello?" },
    });

    expect(res.statusCode).toBe(422);
  });
});
