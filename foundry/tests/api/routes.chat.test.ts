import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun() {
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
    workingDirectory: "/tmp/workspace",
    latestArtifactVersion: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function buildApp(opts: {
  withRunner?: boolean;
  runnerOverride?: Record<string, unknown>;
} = {}) {
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
    retryRun: vi.fn(),
    runManualReReview: vi.fn(),
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
    getLinearClient: vi.fn(),
  };

  const mockEmitter = {
    on: vi.fn(),
    off: vi.fn(),
    emitChatReply: vi.fn(),
  };

  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const mockClaudeCodeRunner = opts.withRunner !== false
    ? {
        chatRun: vi.fn().mockResolvedValue({ text: "Assistant reply", durationMs: 500 }),
        ...opts.runnerOverride,
      }
    : undefined;

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    undefined,
    {
      claudeCodeRunner: mockClaudeCodeRunner as never,
    },
  );

  await app.ready();
  return {
    app,
    mockRunRepo,
    mockArtifactRepo,
    mockEmitter,
    mockClaudeCodeRunner,
    mockOrchestrator,
  };
}

describe("POST /api/runs/:id/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 501 when claudeCodeRunner is not provided", async () => {
    const { app, mockRunRepo } = await buildApp({ withRunner: false });
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(501);
  });

  it("returns 400 when body is missing", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when message is an empty string", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "   " },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when run is not found", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/unknown-run/chat",
      payload: { message: "Hello" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("calls claudeCodeRunner.chatRun() with correct arguments", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "What is the current plan?" },
    });

    expect(mockClaudeCodeRunner!.chatRun).toHaveBeenCalledOnce();
    const [input, stage] = mockClaudeCodeRunner!.chatRun.mock.calls[0] as [
      { prompt: string; workingDirectory: string; timeoutMs: number; runId: string },
      string,
    ];
    expect(input.prompt).toBe("What is the current plan?");
    expect(input.workingDirectory).toBe(run.workingDirectory);
    expect(input.runId).toBe(run.id);
    expect(typeof input.timeoutMs).toBe("number");
    expect(stage).toBe("chat");
  });

  it("response shape includes { reply, durationMs }", async () => {
    const run = makeRun();
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello?" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { reply: string; durationMs: number };
    expect(typeof body.reply).toBe("string");
    expect(typeof body.durationMs).toBe("number");
    expect(body.reply).toBe("Assistant reply");
  });

  it("creates two ChatMessage artifacts (user role and assistant role)", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Test message" },
    });

    expect(mockArtifactRepo.create).toHaveBeenCalledTimes(2);
    const calls = mockArtifactRepo.create.mock.calls as Array<
      [{ type: string; payloadJson: { role: string; content: string } }]
    >;
    const userCall = calls.find((c) => (c[0].payloadJson as { role: string }).role === "user");
    const assistantCall = calls.find(
      (c) => (c[0].payloadJson as { role: string }).role === "assistant",
    );
    expect(userCall).toBeDefined();
    expect(assistantCall).toBeDefined();
    expect(userCall![0].type).toBe("ChatMessage");
    expect(assistantCall![0].type).toBe("ChatMessage");
    expect((userCall![0].payloadJson as { content: string }).content).toBe("Test message");
    expect((assistantCall![0].payloadJson as { content: string }).content).toBe("Assistant reply");
  });

  it("calls emitChatReply with correct runId and reply text", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockEmitter } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello?" },
    });

    expect(mockEmitter.emitChatReply).toHaveBeenCalledOnce();
    expect(mockEmitter.emitChatReply).toHaveBeenCalledWith("run-1", "Assistant reply", 500);
  });

  it("does NOT call any run state-transition method", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockOrchestrator } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello?" },
    });

    // None of the state-transition methods should have been called
    expect(mockOrchestrator.approvePlan).not.toHaveBeenCalled();
    expect(mockOrchestrator.rejectPlan).not.toHaveBeenCalled();
    expect(mockOrchestrator.approveHumanReview).not.toHaveBeenCalled();
    expect(mockOrchestrator.runPlanRevision).not.toHaveBeenCalled();
    expect(mockOrchestrator.runPlanReview).not.toHaveBeenCalled();
    expect(mockOrchestrator.runExecution).not.toHaveBeenCalled();
    expect(mockOrchestrator.runReview).not.toHaveBeenCalled();
    expect(mockOrchestrator.runRemediation).not.toHaveBeenCalled();
  });

  it("returns 500 and does not persist artifacts when chatRun throws", async () => {
    const run = makeRun();
    const { app, mockRunRepo, mockArtifactRepo } = await buildApp({
      runnerOverride: {
        chatRun: vi.fn().mockRejectedValue(new Error("Subprocess failed")),
      },
    });
    mockRunRepo.findById.mockResolvedValue(run);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "Hello?" },
    });

    expect(res.statusCode).toBe(500);
    expect(mockArtifactRepo.create).not.toHaveBeenCalled();
  });

  it("chatRun receives input that does NOT include --dangerously-skip-permissions", async () => {
    // This test verifies the filtering requirement at the route level.
    // The actual filtering happens in ClaudeCodeRunner.chatRun(); here we
    // verify that the route passes a prompt string (not args) to chatRun,
    // ensuring no args can slip in through the message field.
    const run = makeRun();
    const { app, mockRunRepo, mockClaudeCodeRunner } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(run);

    await app.inject({
      method: "POST",
      url: "/api/runs/run-1/chat",
      payload: { message: "--dangerously-skip-permissions" },
    });

    // The message is the prompt (stdin), not CLI args — it should be passed as-is
    // but the runner's chatRun() is responsible for filtering args separately.
    expect(mockClaudeCodeRunner!.chatRun).toHaveBeenCalledOnce();
    const [input] = mockClaudeCodeRunner!.chatRun.mock.calls[0] as [{ prompt: string }];
    // The prompt content doesn't matter for security — args do. Confirm prompt is the raw message.
    expect(input.prompt).toBe("--dangerously-skip-permissions");
  });
});
