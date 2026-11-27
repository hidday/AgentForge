import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentRuntime } from "../../src/domain/types.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import { z } from "zod";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

function makeRunners() {
  const output: AgentOutput<{ ok: boolean }> = {
    raw: "raw",
    parsed: { ok: true },
    success: true,
    stage: "planner",
    durationMs: 10,
  };
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(output) },
    codexRunner: { run: vi.fn().mockResolvedValue(output) },
    cursorRunner: { run: vi.fn().mockResolvedValue(output) },
    output,
  };
}

describe("AgentRunner.run()", () => {
  it("routes to claudeCodeRunner.run() for runtime 'claude-code'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner, output } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(result).toBe(output);
    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to codexRunner.run() for runtime 'codex'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "codex",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "plan-reviewer",
      schema,
    );

    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to cursorRunner.run() for runtime 'cursor'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "cursor",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      schema,
    );

    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unrecognized runtime (exhaustiveness guard)", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run(
        "bogus-runtime" as AgentRuntime,
        { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow(/Unknown runtime: bogus-runtime/);
  });

  it("preserves an explicit input.model override instead of resolving one from the stage", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000, model: "custom-model-xyz" },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0] as [{ model?: string }];
    expect(routedInput.model).toBe("custom-model-xyz");
  });

  it("resolves a model from the stage's tier when input.model is not provided (lead tier -> CLAUDE_CODE_MODEL)", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0] as [{ model?: string }];
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
  });

  it("resolves a model from the stage's tier when input.model is not provided (review tier -> CODEX_MODEL)", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "codex",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "plan-reviewer",
      schema,
    );

    const [routedInput] = codexRunner.run.mock.calls[0] as [{ model?: string }];
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("resolves a model from the stage's tier when input.model is not provided (research tier -> CLAUDE_CODE_MODEL_RESEARCH)", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "answer-researcher",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0] as [{ model?: string }];
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL_RESEARCH);
  });

  it("passes the stage and schema through unchanged to the underlying runner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "remediation",
      schema,
    );

    const [, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0] as [
      unknown,
      string,
      typeof schema,
    ];
    expect(stage).toBe("remediation");
    expect(passedSchema).toBe(schema);
  });

  it("logs routing info with runtime, stage, and resolved model", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: env.CLAUDE_CODE_MODEL },
      "Routing agent execution",
    );
  });
});
