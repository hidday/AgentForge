import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

function makeOutput(raw: string): AgentOutput<unknown> {
  return { raw, parsed: { ok: true }, success: true, stage: "executor", durationMs: 1 };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeOutput("claude")) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeOutput("codex")) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeOutput("cursor")) },
  };
}

const baseInput: AgentInput = {
  prompt: "do the thing",
  workingDirectory: "/tmp/work",
  timeoutMs: 1000,
};

describe("AgentRunner.run()", () => {
  it("routes claude-code runtime to the claudeCodeRunner and returns its output", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const out = await runner.run("claude-code", baseInput, "executor", schema);

    expect(out.raw).toBe("claude");
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes codex runtime to the codexRunner and returns its output", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const out = await runner.run("codex", baseInput, "plan-reviewer", schema);

    expect(out.raw).toBe("codex");
    expect(runners.codexRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the cursorRunner and returns its output", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const out = await runner.run("cursor", baseInput, "executor", schema);

    expect(out.raw).toBe("cursor");
    expect(runners.cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("throws for an unknown runtime", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run("not-a-real-runtime" as AgentRuntime, baseInput, "executor", schema),
    ).rejects.toThrow("Unknown runtime: not-a-real-runtime");

    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("preserves an explicit model override instead of resolving a default", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { ...baseInput, model: "my-custom-model" },
      "executor",
      schema,
    );

    const calledInput = runners.claudeCodeRunner.run.mock.calls[0]![0] as AgentInput;
    expect(calledInput.model).toBe("my-custom-model");
  });

  it("resolves a default model from stage tier when none is provided on the input", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    // "executor" is a "lead" tier stage -> resolves to env.CLAUDE_CODE_MODEL.
    await runner.run("claude-code", baseInput, "executor", schema);
    const claudeInput = runners.claudeCodeRunner.run.mock.calls[0]![0] as AgentInput;
    expect(claudeInput.model).toBe(env.CLAUDE_CODE_MODEL);

    // "plan-reviewer" is a "review" tier stage -> resolves to env.CODEX_MODEL.
    await runner.run("codex", baseInput, "plan-reviewer", schema);
    const codexInput = runners.codexRunner.run.mock.calls[0]![0] as AgentInput;
    expect(codexInput.model).toBe(env.CODEX_MODEL);
  });

  it("does not mutate the caller's original input object", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { ...baseInput };
    await runner.run("claude-code", input, "executor", schema);
    expect(input).not.toHaveProperty("model");
  });

  it("logs routing information before dispatching", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await runner.run("claude-code", baseInput, "executor", schema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "executor" }),
      "Routing agent execution",
    );
  });

  it("propagates a rejection from the underlying runner", async () => {
    const runners = makeRunners();
    runners.claudeCodeRunner.run.mockRejectedValueOnce(new Error("boom"));
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await expect(runner.run("claude-code", baseInput, "executor", schema)).rejects.toThrow(
      "boom",
    );
  });
});
