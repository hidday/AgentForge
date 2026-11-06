import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const echoSchema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

function makeOutput() {
  return {
    raw: "raw",
    parsed: { success: true, stage: "planner" as const, payload: { value: "ok" } },
    success: true,
    stage: "planner" as const,
    durationMs: 10,
  };
}

function buildRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
  };
}

describe("AgentRunner.run()", () => {
  it("dispatches to the claudeCodeRunner for runtime 'claude-code'", async () => {
    const runners = buildRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const out = await agentRunner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(runners.claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
    expect(out.parsed.payload.value).toBe("ok");
  });

  it("dispatches to the codexRunner for runtime 'codex'", async () => {
    const runners = buildRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "reviewer",
      echoSchema,
    );

    expect(runners.codexRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("dispatches to the cursorRunner for runtime 'cursor'", async () => {
    const runners = buildRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "cursor",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(runners.cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
  });

  it("resolves the stage's default model when the input has no model override", async () => {
    const runners = buildRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const [routedInput] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect((routedInput as { model: string }).model).toBe(env.CLAUDE_CODE_MODEL);
  });

  it("resolves the review-tier model for a codex-runtime stage", async () => {
    const runners = buildRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "reviewer",
      echoSchema,
    );

    const [routedInput] = runners.codexRunner.run.mock.calls[0]!;
    expect((routedInput as { model: string }).model).toBe(env.CODEX_MODEL);
  });

  it("preserves an explicit per-call model override instead of resolving the default", async () => {
    const runners = buildRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "custom-model-x" },
      "planner",
      echoSchema,
    );

    const [routedInput] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect((routedInput as { model: string }).model).toBe("custom-model-x");
  });

  it("passes the stage and schema through to the selected runner unchanged", async () => {
    const runners = buildRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const [routedInput, stageArg, schemaArg] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(stageArg).toBe("planner");
    expect(schemaArg).toBe(echoSchema);
    expect((routedInput as { prompt: string }).prompt).toBe("x");
  });

  it("logs the routing decision with runtime, stage and resolved model", async () => {
    const runners = buildRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner", model: env.CLAUDE_CODE_MODEL }),
      "Routing agent execution",
    );
  });

  it("throws a descriptive error for an unrecognized runtime", async () => {
    const runners = buildRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await expect(
      agentRunner.run(
        "made-up-runtime" as never,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow("Unknown runtime: made-up-runtime");

    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("propagates an error thrown by the underlying runner", async () => {
    const runners = buildRunners();
    runners.claudeCodeRunner.run = vi.fn().mockRejectedValue(new Error("CLI exploded"));
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await expect(
      agentRunner.run(
        "claude-code",
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow("CLI exploded");
  });
});
