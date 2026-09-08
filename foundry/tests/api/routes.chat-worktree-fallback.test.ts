import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Covers the chat route's fallback logic for a run whose `workingDirectory`
// no longer exists on disk (e.g. the run's git worktree was cleaned up after
// the run finished): it should retry against the base repo directory
// (stripping a trailing `/.worktrees/<branch>` suffix) and only 422 if that
// fallback also doesn't exist.

function makeRun(workingDirectory: string) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "org/repo",
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
  const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };
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

describe("POST /api/runs/:id/chat worktree cleanup fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 422 when workingDirectory does not exist and has no /.worktrees/ segment to fall back from", async () => {
    const run = makeRun("/nonexistent/plain/path/that/should/not/exist");
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

  it("returns 422 when workingDirectory does not exist and the /.worktrees/ base directory also does not exist", async () => {
    const run = makeRun("/nonexistent/base-repo/.worktrees/run-1-branch");
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
  });

  it("falls back to the base repo directory and succeeds when the worktree is gone but the base repo exists", async () => {
    const baseRepoDir = mkdtempSync(join(tmpdir(), "chat-fallback-base-"));
    const worktreePath = join(baseRepoDir, ".worktrees", "run-1-branch");
    const run = makeRun(worktreePath);
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockClaudeCodeRunner.chatRun).toHaveBeenCalledOnce();
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    // cwd should have been rewritten to the base repo dir (the /.worktrees/... suffix stripped)
    expect(input.workingDirectory).toBe(baseRepoDir);
  });
});
