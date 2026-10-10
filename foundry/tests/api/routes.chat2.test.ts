import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Covers the chat route's working-directory fallback branches that
// tests/api/routes.chat.test.ts (always backed by a real, existing tmp dir)
// does not exercise: the "/.worktrees/" fallback slicing, and the 422
// "directory not found" response.
const realDir = mkdtempSync(join(tmpdir(), "routes-chat2-real-"));

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
    workingDirectory: "/tmp/does-not-exist-nowhere",
    latestArtifactVersion: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
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

describe("POST /api/runs/:id/chat — working-directory fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 422 when workingDirectory is missing and has no /.worktrees/ segment", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun({ workingDirectory: "/tmp/definitely-missing-dir" }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toContain("Working directory not found");
  });

  it("falls back to the base repo dir when the worktree under /.worktrees/ is missing but the base exists", async () => {
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    const worktreePath = join(realDir, ".worktrees", "some-branch");
    mockRunRepo.findById.mockResolvedValue(makeRun({ workingDirectory: worktreePath }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockClaudeCodeRunner.chatRun).toHaveBeenCalledOnce();
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(realDir);
  });

  it("returns 422 when the /.worktrees/ fallback base dir also does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    const worktreePath = "/tmp/missing-repo-root/.worktrees/some-branch";
    mockRunRepo.findById.mockResolvedValue(makeRun({ workingDirectory: worktreePath }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
  });

  it("returns 500 when chatRun rejects a non-Error value", async () => {
    const { app, mockRunRepo } = await buildApp({
      // eslint-disable-next-line prefer-promise-reject-errors
      chatRun: vi.fn().mockRejectedValue("subprocess crashed (string)"),
    });
    mockRunRepo.findById.mockResolvedValue(makeRun({ workingDirectory: realDir }));

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(500);
  });
});
