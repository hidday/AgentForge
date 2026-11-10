import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeRunnerMock<T>(output: AgentOutput<T>) {
  return { run: vi.fn().mockResolvedValue(output) };
}

const schema = z.object({ success: z.boolean(), stage: z.literal("planner") });

const baseInput: AgentInput = {
  prompt: "do the thing",
  workingDirectory: "/tmp/work",
  timeoutMs: 1000,
};

describe("AgentRunner.run", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("routes to the claude-code runner for runtime 'claude-code'", async () => {
    const output: AgentOutput<{ success: boolean; stage: "planner" }> = {
      raw: "raw",
      parsed: { success: true, stage: "planner" },
      success: true,
      stage: "planner",
      durationMs: 10,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };

    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run("claude-code", baseInput, "planner", schema);

    expect(result).toBe(output);
    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the codex runner for runtime 'codex'", async () => {
    const output: AgentOutput<{ success: boolean; stage: "planner" }> = {
      raw: "raw",
      parsed: { success: true, stage: "planner" },
      success: true,
      stage: "planner",
      durationMs: 5,
    };
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = makeRunnerMock(output);
    const cursorRunner = { run: vi.fn() };

    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run("codex", baseInput, "planner", schema);

    expect(result).toBe(output);
    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the cursor runner for runtime 'cursor'", async () => {
    const output: AgentOutput<{ success: boolean; stage: "planner" }> = {
      raw: "raw",
      parsed: { success: true, stage: "planner" },
      success: true,
      stage: "planner",
      durationMs: 7,
    };
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = makeRunnerMock(output);

    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run("cursor", baseInput, "planner", schema);

    expect(result).toBe(output);
    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime instead of silently falling through", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };

    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      agentRunner.run("not-a-real-runtime" as AgentRuntime, baseInput, "planner", schema),
    ).rejects.toThrow(/Unknown runtime: not-a-real-runtime/);

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("passes input.model through unchanged when explicitly provided", async () => {
    const output: AgentOutput<{ success: boolean; stage: "planner" }> = {
      raw: "raw",
      parsed: { success: true, stage: "planner" },
      success: true,
      stage: "planner",
      durationMs: 1,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };

    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "claude-code",
      { ...baseInput, model: "explicit-model-override" },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("explicit-model-override");
  });

  it("resolves a default model from stage/env when input.model is not set, and logs the routing decision", async () => {
    const output: AgentOutput<{ success: boolean; stage: "planner" }> = {
      raw: "raw",
      parsed: { success: true, stage: "planner" },
      success: true,
      stage: "planner",
      durationMs: 1,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };

    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run("claude-code", baseInput, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(typeof routedInput.model).toBe("string");
    expect(routedInput.model.length).toBeGreaterThan(0);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("does not mutate the original input object", async () => {
    const output: AgentOutput<{ success: boolean; stage: "planner" }> = {
      raw: "raw",
      parsed: { success: true, stage: "planner" },
      success: true,
      stage: "planner",
      durationMs: 1,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };

    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { ...baseInput };
    await agentRunner.run("claude-code", input, "planner", schema);

    expect(input.model).toBeUndefined();
  });
});
