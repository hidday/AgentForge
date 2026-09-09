import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

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

async function buildApp(runnerOverride: Record<string, unknown> = {}) {
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
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockClaudeCodeRunner = {
    chatRun: vi.fn().mockResolvedValue({ text: "Assistant reply", durationMs: 500 }),
    ...runnerOverride,
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

describe("POST /api/runs/:id/chat -- workingDirectory fallback branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back to the repo root when the worktree path is gone but the repo root still exists", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "routes-chat-fallback-"));
    const goneWorktree = join(repoRoot, ".worktrees", "run-1");
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(goneWorktree));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "still there?" },
    });

    expect(res.statusCode).toBe(200);
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(repoRoot);
  });

  it("returns 422 when the working directory is gone and has no /.worktrees/ segment to fall back from", async () => {
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun("/definitely/does/not/exist/anywhere"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toContain("Working directory not found");
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 422 when the /.worktrees/ fallback root also does not exist", async () => {
    const goneWorktree = "/definitely/does/not/exist/.worktrees/run-1";
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(goneWorktree));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 500 with a stringified message when chatRun rejects with a non-Error value", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "routes-chat-nonerror-"));
    const { app, mockRunRepo } = await buildApp({
      // eslint-disable-next-line prefer-promise-reject-errors
      chatRun: vi.fn().mockRejectedValue("plain chat failure"),
    });
    mockRunRepo.findById.mockResolvedValue(makeRun(workspaceDir));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hello" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Chat request failed" });
  });
});
