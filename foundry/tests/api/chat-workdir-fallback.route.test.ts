import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

/**
 * Covers the chat route's working-directory fallback logic (routes.ts), which
 * the main routes.chat.test.ts suite never exercises because its fixture run
 * always points at a directory that exists on disk:
 *
 *   let chatCwd = run.workingDirectory;
 *   if (!existsSync(chatCwd)) {
 *     // strip a `/.worktrees/<id>` suffix and retry against the main repo dir
 *     if (!existsSync(chatCwd)) return 422;
 *   }
 */

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
  const mockRunRepo = { findById: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  };
  const mockEventRepo = { findByRunId: vi.fn() };

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

describe("POST /api/runs/:id/chat — working directory fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to the main repo dir when workingDirectory is a missing worktree path", async () => {
    const mainRepoDir = mkdtempSync(join(tmpdir(), "chat-fallback-main-"));
    const missingWorktree = join(mainRepoDir, ".worktrees", "stale-run-id");
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(missingWorktree));

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

  it("returns 422 when neither the worktree path nor its parent repo dir exists", async () => {
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun("/nonexistent/path/.worktrees/abc"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain("Working directory not found");
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 422 when workingDirectory is missing and has no /.worktrees/ segment to strip", async () => {
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun("/totally/missing/dir"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });
});
