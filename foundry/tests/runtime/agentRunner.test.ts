import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ value: z.string() });

function makeOutput(): AgentOutput<{ value: string }> {
  return {
    raw: "raw",
    parsed: { value: "ok" },
    success: true,
    stage: "planner",
    durationMs: 10,
  };
}

describe("AgentRunner.run()", () => {
  it("routes to ClaudeCodeRunner for runtime 'claude-code' and applies the default lead-tier model", async () => {
    const output = makeOutput();
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(output) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(result).toBe(output);
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
    expect(routedInput.prompt).toBe("x");
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
  });

  it("routes to CodexRunner for runtime 'codex' and applies the review-tier model for review stages", async () => {
    const output = makeOutput();
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(output) };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "review this", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("codex", input, "plan-reviewer", schema);

    expect(result).toBe(output);
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("routes to CursorRunner for runtime 'cursor'", async () => {
    const output = makeOutput();
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(output) };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("cursor", input, "executor", schema);

    expect(result).toBe(output);
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("preserves an explicit input.model override instead of resolving a default", async () => {
    const output = makeOutput();
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(output) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = {
      prompt: "x",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-override-model",
    };
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-override-model");
  });

  it("propagates a rejection from the underlying runner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(new Error("boom")) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run(
        "claude-code",
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("boom");
  });

  it("throws for an unknown/unrecognized runtime value", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(
      runner.run("not-a-real-runtime" as AgentRuntime, input, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);
  });

  it("logs the routing decision at info level", async () => {
    const output = makeOutput();
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(output) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });
});
