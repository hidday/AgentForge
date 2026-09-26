import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

const schema = z.object({ ok: z.boolean() });

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeRunners(output: AgentOutput<unknown>) {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(output) },
    codexRunner: { run: vi.fn().mockResolvedValue(output) },
    cursorRunner: { run: vi.fn().mockResolvedValue(output) },
  };
}

const sampleOutput: AgentOutput<unknown> = {
  raw: "{}",
  parsed: { ok: true },
  success: true,
  stage: "planner",
  durationMs: 10,
};

describe("AgentRunner.run", () => {
  it("routes 'claude-code' runtime to the ClaudeCodeRunner and returns its output", async () => {
    const runners = makeRunners(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(result).toBe(sampleOutput);
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, passedSchema] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    // planner is a "lead" tier stage -> resolves to CLAUDE_CODE_MODEL
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
    expect(routedInput.prompt).toBe("p");
  });

  it("routes 'codex' runtime to the CodexRunner", async () => {
    const runners = makeRunners(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("codex", input, "plan-reviewer", schema);

    expect(runners.codexRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput] = runners.codexRunner.run.mock.calls[0]!;
    // plan-reviewer is a "review" tier stage -> resolves to CODEX_MODEL
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("routes 'cursor' runtime to the CursorRunner", async () => {
    const runners = makeRunners(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("cursor", input, "executor", schema);

    expect(runners.cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses the caller-supplied model instead of resolving one from env when input.model is set", async () => {
    const runners = makeRunners(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = {
      prompt: "p",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-model-override",
    };
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");
  });

  it("logs the routing decision at info level", async () => {
    const runners = makeRunners(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("claude-code", input, "planner", schema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("throws for an unknown/unsupported runtime value", async () => {
    const runners = makeRunners(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(
      runner.run("bogus-runtime" as AgentRuntime, input, "planner", schema),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");
  });

  it("propagates a rejection from the underlying runner", async () => {
    const runners = makeRunners(sampleOutput);
    runners.claudeCodeRunner.run.mockRejectedValueOnce(new Error("boom"));
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(runner.run("claude-code", input, "planner", schema)).rejects.toThrow("boom");
  });
});
