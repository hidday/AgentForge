import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

function makeOutput(): AgentOutput<{ ok: boolean }> {
  return { raw: "raw", parsed: { ok: true }, success: true, stage: "planner", durationMs: 5 };
}

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000, ...overrides };
}

describe("AgentRunner.run()", () => {
  it("routes claude-code runtime to the ClaudeCodeRunner with a resolved model", async () => {
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

    const input = makeInput();
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(result).toBe(output);
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toEqual({ ...input, model: env.CLAUDE_CODE_MODEL });
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: env.CLAUDE_CODE_MODEL },
      "Routing agent execution",
    );
  });

  it("routes codex runtime to the CodexRunner with the review-tier model", async () => {
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

    const input = makeInput();
    const result = await runner.run("codex", input, "plan-reviewer", schema);

    expect(result).toBe(output);
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput, stage] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CODEX_MODEL);
    expect(stage).toBe("plan-reviewer");
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the CursorRunner", async () => {
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

    // cursor isn't used by any real AGENT_STAGES entry, but AgentRunner must
    // still dispatch to it correctly for any stage passed explicitly.
    const input = makeInput();
    const result = await runner.run("cursor", input, "executor", schema);

    expect(result).toBe(output);
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("uses the caller-supplied model instead of resolving one when input.model is set", async () => {
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

    const input = makeInput({ model: "custom-model-override" });
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");
    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: "custom-model-override" },
      "Routing agent execution",
    );
  });

  it("throws for an unknown runtime without invoking any runner", async () => {
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

    const input = makeInput();
    await expect(
      runner.run("bogus-runtime" as never, input, "planner", schema),
    ).rejects.toThrow(/Unknown runtime: bogus-runtime/);

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the underlying runner", async () => {
    const failure = new Error("CLI exploded");
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(failure) };
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
      runner.run("claude-code", makeInput(), "planner", schema),
    ).rejects.toThrow("CLI exploded");
  });
});
