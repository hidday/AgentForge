import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { CodexRunner } from "../../src/runtime/codexRunner.js";
import type { CursorRunner } from "../../src/runtime/cursorRunner.js";
import type { AgentRuntime } from "../../src/domain/types.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const echoSchema = z.object({ ok: z.boolean() });

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn() },
    codexRunner: { run: vi.fn() },
    cursorRunner: { run: vi.fn() },
  };
}

describe("AgentRunner.run()", () => {
  it("routes to claudeCodeRunner and resolves the model via resolveAgentModel when input.model is unset", async () => {
    const runners = makeRunners();
    const expectedOutput: AgentOutput<{ ok: boolean }> = {
      raw: "raw",
      parsed: { ok: true },
      success: true,
      stage: "planner",
      durationMs: 10,
    };
    runners.claudeCodeRunner.run.mockResolvedValue(expectedOutput);
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      runners.claudeCodeRunner as unknown as ClaudeCodeRunner,
      runners.codexRunner as unknown as CodexRunner,
      runners.cursorRunner as unknown as CursorRunner,
      logger as never,
    );

    const input = { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("claude-code", input, "planner", echoSchema);

    expect(result).toBe(expectedOutput);
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();

    // "planner" is a "lead" tier stage -> resolves to env.CLAUDE_CODE_MODEL
    const [routedInput, stage, schema] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toEqual({ ...input, model: env.CLAUDE_CODE_MODEL });
    expect(stage).toBe("planner");
    expect(schema).toBe(echoSchema);

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: env.CLAUDE_CODE_MODEL },
      "Routing agent execution",
    );
  });

  it("uses input.model directly (skipping resolution) and routes to codexRunner for a review-tier stage", async () => {
    const runners = makeRunners();
    const expectedOutput: AgentOutput<{ ok: boolean }> = {
      raw: "raw",
      parsed: { ok: true },
      success: true,
      stage: "reviewer",
      durationMs: 5,
    };
    runners.codexRunner.run.mockResolvedValue(expectedOutput);
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      runners.claudeCodeRunner as unknown as ClaudeCodeRunner,
      runners.codexRunner as unknown as CodexRunner,
      runners.cursorRunner as unknown as CursorRunner,
      logger as never,
    );

    const input = {
      prompt: "review it",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-explicit-model",
    };
    const result = await runner.run("codex", input, "reviewer", echoSchema);

    expect(result).toBe(expectedOutput);
    expect(runners.codexRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput] = runners.codexRunner.run.mock.calls[0]!;
    // Explicit input.model must win over resolveAgentModel's env.CODEX_MODEL default.
    expect(routedInput.model).toBe("custom-explicit-model");
  });

  it("routes to cursorRunner when runtime is 'cursor'", async () => {
    const runners = makeRunners();
    const expectedOutput: AgentOutput<{ ok: boolean }> = {
      raw: "raw",
      parsed: { ok: true },
      success: true,
      stage: "executor",
      durationMs: 7,
    };
    runners.cursorRunner.run.mockResolvedValue(expectedOutput);
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      runners.claudeCodeRunner as unknown as ClaudeCodeRunner,
      runners.codexRunner as unknown as CodexRunner,
      runners.cursorRunner as unknown as CursorRunner,
      logger as never,
    );

    const input = { prompt: "execute it", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("cursor", input, "executor", echoSchema);

    expect(result).toBe(expectedOutput);
    expect(runners.cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws 'Unknown runtime' for an invalid runtime value (default/exhaustiveness branch)", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      runners.claudeCodeRunner as unknown as ClaudeCodeRunner,
      runners.codexRunner as unknown as CodexRunner,
      runners.cursorRunner as unknown as CursorRunner,
      logger as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    const invalidRuntime = "not-a-real-runtime" as unknown as AgentRuntime;

    await expect(runner.run(invalidRuntime, input, "planner", echoSchema)).rejects.toThrow(
      "Unknown runtime: not-a-real-runtime",
    );

    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });
});
