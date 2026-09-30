import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockRunner() {
  return {
    run: vi.fn().mockResolvedValue({
      raw: "raw",
      parsed: { ok: true },
      success: true,
      stage: "planner",
      durationMs: 10,
    }),
  };
}

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

describe("AgentRunner.run", () => {
  it("routes to the ClaudeCodeRunner for runtime 'claude-code'", async () => {
    const claudeCodeRunner = makeMockRunner();
    const codexRunner = makeMockRunner();
    const cursorRunner = makeMockRunner();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await agentRunner.run("claude-code", input, "planner", schema);

    expect(out.parsed).toEqual({ ok: true });
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    // model is resolved from env when not explicitly provided on input
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
    expect(routedInput.prompt).toBe("hi");
  });

  it("routes to the CodexRunner for runtime 'codex'", async () => {
    const claudeCodeRunner = makeMockRunner();
    const codexRunner = makeMockRunner();
    const cursorRunner = makeMockRunner();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "review this", workingDirectory: "/tmp", timeoutMs: 1000 };
    await agentRunner.run("codex", input, "reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    const [routedInput, stage] = codexRunner.run.mock.calls[0]!;
    expect(stage).toBe("reviewer");
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("routes to the CursorRunner for runtime 'cursor'", async () => {
    const claudeCodeRunner = makeMockRunner();
    const codexRunner = makeMockRunner();
    const cursorRunner = makeMockRunner();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "execute this", workingDirectory: "/tmp", timeoutMs: 1000 };
    await agentRunner.run("cursor", input, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("preserves an explicit input.model instead of resolving one from env", async () => {
    const claudeCodeRunner = makeMockRunner();
    const codexRunner = makeMockRunner();
    const cursorRunner = makeMockRunner();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = {
      prompt: "hi",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-model-override",
    };
    await agentRunner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");
  });

  it("logs the routing decision", async () => {
    const claudeCodeRunner = makeMockRunner();
    const codexRunner = makeMockRunner();
    const cursorRunner = makeMockRunner();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "claude-code",
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("throws a descriptive error for an unknown runtime", async () => {
    const claudeCodeRunner = makeMockRunner();
    const codexRunner = makeMockRunner();
    const cursorRunner = makeMockRunner();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const bogusRuntime = "not-a-real-runtime" as unknown as AgentRuntime;

    await expect(
      agentRunner.run(
        bogusRuntime,
        { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow(/Unknown runtime: not-a-real-runtime/);

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });
});
