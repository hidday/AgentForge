import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

const schema = z.object({ ok: z.boolean() });

function makeRunners() {
  const output: AgentOutput<unknown> = {
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

describe("AgentRunner.run() — dispatch", () => {
  it("dispatches 'claude-code' runtime to the ClaudeCodeRunner and returns its result", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner, output } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(result).toBe(output);
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    // model unset on input -> resolved via resolveAgentModel(stage, env); "planner" is a
    // "lead" tier stage, so it should resolve to CLAUDE_CODE_MODEL.
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
    expect(routedInput.prompt).toBe("p");
  });

  it("dispatches 'codex' runtime to the CodexRunner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner, output } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("codex", input, "plan-reviewer", schema);

    expect(result).toBe(output);
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput] = codexRunner.run.mock.calls[0]!;
    // "plan-reviewer" is a "review" tier stage -> CODEX_MODEL.
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("dispatches 'cursor' runtime to the CursorRunner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner, output } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("cursor", input, "answer-researcher", schema);

    expect(result).toBe(output);
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();

    const [routedInput] = cursorRunner.run.mock.calls[0]!;
    // "answer-researcher" is a "research" tier stage -> CLAUDE_CODE_MODEL_RESEARCH.
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL_RESEARCH);
  });

  it("preserves an explicit per-call model override instead of resolving one from env", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = {
      prompt: "p",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-override-model",
    };
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-override-model");
  });

  it("logs the routing decision with runtime, stage, and resolved model", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
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

  it("throws a descriptive error for an unknown/unsupported runtime value", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const bogusRuntime = "bogus-runtime" as unknown as AgentRuntime;

    await expect(
      runner.run(
        bogusRuntime,
        { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the underlying runner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    claudeCodeRunner.run.mockRejectedValueOnce(new Error("boom"));
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
        { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("boom");
  });
});
