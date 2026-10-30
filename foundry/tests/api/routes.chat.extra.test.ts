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
    workingDirectory: "/tmp",
    latestArtifactVersion: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function buildApp() {
  const mockRunRepo = { findById: vi.fn() };
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
  beforeEach(() => vi.clearAllMocks());

  it("uses workingDirectory as-is when it exists on disk", async () => {
    const realDir = mkdtempSync(join(tmpdir(), "chat-extra-real-"));
    try {
      const run = makeRun({ workingDirectory: realDir });
      const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "Hello" },
      });

      expect(res.statusCode).toBe(200);
      const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
      expect(input.workingDirectory).toBe(realDir);
    } finally {
      rmSync(realDir, { recursive: true, force: true });
    }
  });

  it("falls back to the main repo dir when the worktree path under it is gone", async () => {
    const mainRepoDir = mkdtempSync(join(tmpdir(), "chat-extra-main-"));
    try {
      const goneWorktree = join(mainRepoDir, ".worktrees", "run-1");
      const run = makeRun({ workingDirectory: goneWorktree });
      const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "Hello" },
      });

      expect(res.statusCode).toBe(200);
      const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
      expect(input.workingDirectory).toBe(mainRepoDir);
    } finally {
      rmSync(mainRepoDir, { recursive: true, force: true });
    }
  });

  it("returns 422 when neither the worktree nor the fallback main repo dir exists", async () => {
    const run = makeRun({
      workingDirectory: "/tmp/definitely-does-not-exist-xyz/.worktrees/run-1",
    });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toContain("Working directory not found");
  });

  it("returns 422 when workingDirectory is missing entirely and has no /.worktrees/ segment", async () => {
    const run = makeRun({ workingDirectory: "/tmp/no-such-dir-at-all-xyz" });
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
  });
});

describe("POST /api/runs/:id/chat — non-Error rejection from chatRun", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 500 with a generic message when chatRun rejects with a non-Error value", async () => {
    const realDir = mkdtempSync(join(tmpdir(), "chat-extra-nonerror-"));
    try {
      const run = makeRun({ workingDirectory: realDir });
      const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockClaudeCodeRunner.chatRun.mockRejectedValue("subprocess crashed");

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/chat",
        payload: { message: "Hello" },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "Chat request failed" });
    } finally {
      rmSync(realDir, { recursive: true, force: true });
    }
  });
});
