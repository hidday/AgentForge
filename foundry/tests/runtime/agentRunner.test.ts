import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ success: z.boolean(), stage: z.literal("planner") });

function makeOutput(stage: "planner" = "planner"): AgentOutput<unknown> {
  return { raw: "raw", parsed: { success: true, stage }, success: true, stage, durationMs: 1 };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn() },
    codexRunner: { run: vi.fn() },
    cursorRunner: { run: vi.fn() },
  };
}

describe("AgentRunner.run()", () => {
  it("routes to the Claude Code runner for runtime 'claude-code'", async () => {
    const runners = makeRunners();
    const output = makeOutput();
    runners.claudeCodeRunner.run.mockResolvedValue(output);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const result = await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "pinned-model" },
      "planner",
      schema,
    );

    expect(result).toBe(output);
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "x", model: "pinned-model" }),
      "planner",
      schema,
    );
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the Codex runner for runtime 'codex'", async () => {
    const runners = makeRunners();
    runners.codexRunner.run.mockResolvedValue(makeOutput());
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    await runner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
      "plan-reviewer",
      schema,
    );

    expect(runners.codexRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the Cursor runner for runtime 'cursor'", async () => {
    const runners = makeRunners();
    runners.cursorRunner.run.mockResolvedValue(makeOutput());
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    await runner.run(
      "cursor",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
      "planner",
      schema,
    );

    expect(runners.cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown/unsupported runtime value", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    await expect(
      runner.run(
        "bogus-runtime" as AgentRuntime,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");
  });

  it("resolves the default model for the stage's tier when input.model is not provided", async () => {
    const runners = makeRunners();
    runners.claudeCodeRunner.run.mockResolvedValue(makeOutput());
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    // "planner" is a "lead" tier stage -> resolves to env.CLAUDE_CODE_MODEL.
    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(runners.claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: env.CLAUDE_CODE_MODEL }),
      "planner",
      schema,
    );
  });

  it("resolves the 'research' tier model for answer-researcher when input.model is not provided", async () => {
    const runners = makeRunners();
    runners.claudeCodeRunner.run.mockResolvedValue({ ...makeOutput(), stage: "answer-researcher" });
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "answer-researcher",
      schema,
    );

    expect(runners.claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: env.CLAUDE_CODE_MODEL_RESEARCH }),
      "answer-researcher",
      schema,
    );
  });

  it("resolves the 'review' tier model (Codex) for plan-reviewer when input.model is not provided", async () => {
    const runners = makeRunners();
    runners.codexRunner.run.mockResolvedValue(makeOutput());
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    await runner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "plan-reviewer",
      schema,
    );

    expect(runners.codexRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: env.CODEX_MODEL }),
      "plan-reviewer",
      schema,
    );
  });

  it("logs routing info with runtime, stage and resolved model", async () => {
    const runners = makeRunners();
    runners.claudeCodeRunner.run.mockResolvedValue(makeOutput());
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "fixed-model" },
      "executor",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "executor", model: "fixed-model" },
      "Routing agent execution",
    );
  });

  it("propagates a rejection from the underlying runner", async () => {
    const runners = makeRunners();
    runners.claudeCodeRunner.run.mockRejectedValue(new Error("boom"));
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    await expect(
      runner.run(
        "claude-code",
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
        "planner",
        schema,
      ),
    ).rejects.toThrow("boom");
  });
});
