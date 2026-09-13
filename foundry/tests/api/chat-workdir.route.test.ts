import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
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
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never, undefined, {
    claudeCodeRunner: mockClaudeCodeRunner as never,
  });

  await app.ready();
  return { app, mockRunRepo, mockClaudeCodeRunner };
}

describe("POST /api/runs/:id/chat — working-directory fallback branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 422 when workingDirectory is missing and has no /.worktrees/ segment to fall back to", async () => {
    const missingDir = join(tmpdir(), `agentforge-missing-${Date.now()}-${Math.random()}`);
    const { app, mockRunRepo } = await buildApp();
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
  });

  it("falls back to the main repo dir when workingDirectory is a missing worktree path whose base still exists", async () => {
    const baseRepoDir = mkdtempSync(join(tmpdir(), "agentforge-base-repo-"));
    try {
      const missingWorktree = join(baseRepoDir, ".worktrees", "run-1-stale");
      const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun(missingWorktree));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "Hello" },
      });

      expect(res.statusCode).toBe(200);
      const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
      expect(input.workingDirectory).toBe(baseRepoDir);
    } finally {
      rmSync(baseRepoDir, { recursive: true, force: true });
    }
  });

  it("returns 422 when workingDirectory has a /.worktrees/ segment but the base repo dir is also missing", async () => {
    const missingBase = join(tmpdir(), `agentforge-missing-base-${Date.now()}-${Math.random()}`);
    const missingWorktree = join(missingBase, ".worktrees", "run-1-stale");
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun(missingWorktree));

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

  it("returns 500 when chatRun rejects with a non-Error value", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agentforge-nonerror-"));
    try {
      const { app, mockRunRepo } = await buildApp({
        chatRun: vi.fn().mockRejectedValue("subprocess exploded"),
      });
      mockRunRepo.findById.mockResolvedValue(makeRun(workspaceDir));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "Hello" },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "Chat request failed" });
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
