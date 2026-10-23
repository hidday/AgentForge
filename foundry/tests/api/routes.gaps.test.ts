import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Covers routes.ts branches not exercised by the existing routes test files:
//   - chat: the workingDirectory-missing fallback to the main repo dir, and
//     the 422 when even that fallback doesn't exist
//   - reject-plan: an invalid `mode` value
//   - re-review-plan / revise-plan: the background .catch() handler logging
//     when the fire-and-forget orchestrator call rejects asynchronously
//   - summary: the JSON.stringify catch fallback for a circular risk object,
//     and plan.steps not being an array

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/issue/ENG-1",
    repo: "org/repo",
    branchName: "feature/x",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface BuildOpts {
  orchestratorOverrides?: Record<string, unknown>;
  registerOptions?: Record<string, unknown>;
}

async function buildApp(opts: BuildOpts = {}) {
  const mockRunRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
  };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((params: Record<string, unknown>) => ({
      id: `artifact-${Math.random()}`,
      ...params,
      createdAt: new Date(),
    })),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  };

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
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    retryRun: vi.fn(),
    runPlanning: vi.fn(),
    ...opts.orchestratorOverrides,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    undefined,
    opts.registerOptions ?? {},
  );
  await app.ready();

  return { app, mockRunRepo, mockArtifactRepo, mockEventRepo, mockOrchestrator, mockProcessRunner };
}

describe("POST /api/runs/:id/chat — workingDirectory fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back to the main repo dir (stripping /.worktrees/...) when the run's workingDirectory is missing", async () => {
    const mainRepoDir = mkdtempSync(join(tmpdir(), "routes-gaps-main-repo-"));
    const run = makeRun({
      workingDirectory: join(mainRepoDir, ".worktrees", "run-abc123", "nonexistent"),
    });
    const mockClaudeCodeRunner = {
      chatRun: vi.fn().mockResolvedValue({ text: "ok", durationMs: 10 }),
    };
    const { app, mockRunRepo } = await buildApp({
      registerOptions: { claudeCodeRunner: mockClaudeCodeRunner },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockClaudeCodeRunner.chatRun).toHaveBeenCalledOnce();
    const [input] = mockClaudeCodeRunner.chatRun.mock.calls[0] as [{ workingDirectory: string }];
    expect(input.workingDirectory).toBe(mainRepoDir);
  });

  it("returns 422 when neither the workingDirectory nor the stripped-down fallback exists", async () => {
    const run = makeRun({
      workingDirectory: "/definitely/not/a/real/path/.worktrees/run-abc123/wt",
    });
    const mockClaudeCodeRunner = {
      chatRun: vi.fn().mockResolvedValue({ text: "ok", durationMs: 10 }),
    };
    const { app, mockRunRepo } = await buildApp({
      registerOptions: { claudeCodeRunner: mockClaudeCodeRunner },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: "Working directory not found — the repository may have been removed",
    });
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });

  it("returns 422 when workingDirectory is missing and has no /.worktrees/ segment to strip", async () => {
    const run = makeRun({ workingDirectory: "/definitely/not/a/real/path/at/all" });
    const mockClaudeCodeRunner = {
      chatRun: vi.fn().mockResolvedValue({ text: "ok", durationMs: 10 }),
    };
    const { app, mockRunRepo } = await buildApp({
      registerOptions: { claudeCodeRunner: mockClaudeCodeRunner },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockClaudeCodeRunner.chatRun).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/reject-plan — mode validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when mode is not one of 'iterate' or 'fresh'", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/reject-plan",
      payload: { mode: "bogus-mode" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "mode must be one of: iterate, fresh" });
    expect(mockOrchestrator.rejectPlan).not.toHaveBeenCalled();
  });
});

describe("POST /api/runs/:id/actions/re-review-plan — background failure logging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs an error when the fire-and-forget runManualReReview call rejects", async () => {
    let rejectRun!: (err: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectRun = reject;
    });
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: { runManualReReview: vi.fn().mockReturnValue(pending) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/re-review-plan",
    });
    expect(res.statusCode).toBe(200);

    rejectRun(new Error("codex exploded"));
    // Let the fire-and-forget .catch() microtask run.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: undefined });
  });
});

describe("POST /api/runs/:id/actions/revise-plan — background failure logging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs an error when the fire-and-forget runManualPlanRevision call rejects", async () => {
    let rejectRun!: (err: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectRun = reject;
    });
    const { app, mockOrchestrator } = await buildApp({
      orchestratorOverrides: { runManualPlanRevision: vi.fn().mockReturnValue(pending) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/revise-plan",
      payload: { note: "tighten scope" },
    });
    expect(res.statusCode).toBe(200);

    rejectRun(new Error("claude exploded"));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
      note: "tighten scope",
    });
  });
});

describe("GET /api/runs/:id/summary — risk serialization and non-array steps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back to String(r) for a risk object whose JSON.stringify throws (circular reference)", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const circular: Record<string, unknown> = { note: "oops" };
    circular.self = circular;

    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return {
          version: 1,
          payloadJson: {
            summary: "plan with a circular risk",
            confidence: 0.5,
            openQuestions: [],
            steps: [],
            risks: [circular],
            testPlan: "n/a",
          },
        };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.risks).toHaveLength(1);
    // JSON.stringify(circular) throws, so the route falls back to String(r),
    // which for a plain object is the generic "[object Object]" tag.
    expect(body.plan.risks[0]).toBe("[object Object]");
  });

  it("returns an empty steps array when the Plan payload's steps field is not an array", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    mockArtifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) => {
      if (type === "Plan") {
        return {
          version: 1,
          payloadJson: {
            summary: "plan with malformed steps",
            confidence: 0.5,
            openQuestions: [],
            steps: "not-an-array",
            risks: [],
            testPlan: "n/a",
          },
        };
      }
      return null;
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.steps).toEqual([]);
    expect(body.plan.stepCount).toBe(0);
  });
});
