import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import { z } from "zod";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    prompt: "do the thing",
    workingDirectory: "/tmp/work",
    timeoutMs: 1000,
    ...overrides,
  };
}

function makeOutput(): AgentOutput<{ ok: boolean }> {
  return { raw: "{}", parsed: { ok: true }, success: true, stage: "executor", durationMs: 1 };
}

function makeLogger() {
  return { info: vi.fn() } as unknown as import("../../src/utils/logger.js").Logger;
}

describe("AgentRunner.run", () => {
  const schema = z.object({ ok: z.boolean() });

  it("routes to the claude-code runner for runtime 'claude-code'", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger,
    );

    const result = await runner.run("claude-code", makeInput(), "executor", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("routes to the codex runner for runtime 'codex'", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger,
    );

    await runner.run("codex", makeInput(), "reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the cursor runner for runtime 'cursor'", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger,
    );

    await runner.run("cursor", makeInput(), "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("throws for an unknown runtime instead of silently routing somewhere", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger,
    );

    await expect(
      runner.run("bogus-runtime" as never, makeInput(), "executor", schema),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("uses the per-call model override when provided, instead of resolving a default", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger,
    );

    await runner.run("claude-code", makeInput({ model: "custom-model" }), "executor", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0];
    expect(routedInput.model).toBe("custom-model");
  });

  it("falls back to the stage's resolved default model when no override is given", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger,
    );

    await runner.run("claude-code", makeInput(), "executor", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0];
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
  });

  it("logs the routing decision with runtime, stage, and model", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger,
    );

    await runner.run("claude-code", makeInput(), "executor", schema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "executor" }),
      "Routing agent execution",
    );
  });
});
