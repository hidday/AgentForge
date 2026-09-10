import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Covers the chat route's workingDirectory-fallback logic (worktree cleanup
// case) and the non-Error rejection path from chatRun — both left uncovered
// by tests/api/routes.chat.test.ts, which is not to be modified here.

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
    state: RunState.Done,
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

async function buildApp(chatRunImpl?: () => Promise<{ text: string; durationMs: number }>) {
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
    chatRun: vi.fn(chatRunImpl ?? (async () => ({ text: "reply", durationMs: 10 }))),
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

describe("POST /api/runs/:id/chat (workingDirectory fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 422 when workingDirectory is missing and has no /.worktrees/ segment", async () => {
    const run = makeRun({ workingDirectory: "/definitely/does/not/exist/plain-repo" });
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
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
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("falls back to the repo root when the worktree is gone but the repo root exists", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "routes-chat-extra-"));
    const worktreePath = join(repoRoot, ".worktrees", "run-1-feature");
    const run = makeRun({ workingDirectory: worktreePath });
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
    expect(input.workingDirectory).toBe(repoRoot);
  });

  it("returns 422 when the worktree AND the repo root are both gone", async () => {
    const worktreePath = "/definitely/does/not/exist/some-repo/.worktrees/run-1-feature";
    const run = makeRun({ workingDirectory: worktreePath });
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 500 when chatRun rejects with a non-Error value", async () => {
    const run = makeRun();
    const { app, mockRunRepo } = await buildApp(() => Promise.reject("stringy failure"));
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Chat request failed" });
  });
});
