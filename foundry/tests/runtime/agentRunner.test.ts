import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import { z } from "zod";

const schema = z.object({ success: z.boolean() });

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeOutput(): AgentOutput<{ success: boolean }> {
  return {
    raw: "{}",
    parsed: { success: true },
    success: true,
    stage: "planner",
    durationMs: 10,
  };
}

describe("AgentRunner.run()", () => {
  it("routes to claudeCodeRunner for runtime 'claude-code' and resolves the default model", async () => {
    const output = makeOutput();
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(output) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(result).toBe(output);
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage] = claudeCodeRunner.run.mock.calls[0] as [
      { model?: string; prompt: string },
      string,
    ];
    expect(stage).toBe("planner");
    expect(routedInput.prompt).toBe("hi");
    // planner is a "lead" tier stage -> resolves to CLAUDE_CODE_MODEL
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("routes to codexRunner for runtime 'codex' and resolves the review-tier model", async () => {
    const output = makeOutput();
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(output) };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();

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
    const [routedInput] = codexRunner.run.mock.calls[0] as [{ model?: string }];
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("routes to cursorRunner for runtime 'cursor'", async () => {
    const output = makeOutput();
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(output) };
    const logger = makeLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("cursor", input, "executor", schema);

    expect(result).toBe(output);
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicit input.model instead of resolving one from the stage", async () => {
    const output = makeOutput();
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(output) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();

    const runner = new AgentRunner(
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
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0] as [{ model?: string }];
    expect(routedInput.model).toBe("custom-model-override");
  });

  it("throws for an unknown runtime value", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(
      runner.run("not-a-real-runtime" as never, input, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);
  });

  it("propagates a rejection from the underlying runner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(new Error("subprocess failed")) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(runner.run("claude-code", input, "planner", schema)).rejects.toThrow(
      "subprocess failed",
    );
  });
});
