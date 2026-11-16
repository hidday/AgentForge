import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockRunner(result: unknown) {
  return {
    run: vi.fn().mockResolvedValue(result),
  };
}

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

const schema = z.object({ success: z.boolean() });

const baseInput: AgentInput = {
  prompt: "do the thing",
  workingDirectory: "/tmp",
  timeoutMs: 1000,
  model: "explicit-model",
};

describe("AgentRunner.run()", () => {
  it("dispatches to claudeCodeRunner for runtime 'claude-code' with the routed input", async () => {
    const claudeCodeRunner = makeMockRunner({ raw: "r", parsed: { success: true } });
    const codexRunner = makeMockRunner(undefined);
    const cursorRunner = makeMockRunner(undefined);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run("claude-code", baseInput, "planner", schema);

    expect(result).toEqual({ raw: "r", parsed: { success: true } });
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    const [routedInput, stageArg, schemaArg] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toEqual({ ...baseInput, model: "explicit-model" });
    expect(stageArg).toBe("planner");
    expect(schemaArg).toBe(schema);
  });

  it("dispatches to codexRunner for runtime 'codex' with the routed input", async () => {
    const claudeCodeRunner = makeMockRunner(undefined);
    const codexRunner = makeMockRunner({ raw: "codex-out", parsed: { success: true } });
    const cursorRunner = makeMockRunner(undefined);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run("codex", baseInput, "reviewer", schema);

    expect(result).toEqual({ raw: "codex-out", parsed: { success: true } });
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    const [routedInput, stageArg] = codexRunner.run.mock.calls[0]!;
    expect(routedInput).toEqual({ ...baseInput, model: "explicit-model" });
    expect(stageArg).toBe("reviewer");
  });

  it("dispatches to cursorRunner for runtime 'cursor' with the routed input", async () => {
    const claudeCodeRunner = makeMockRunner(undefined);
    const codexRunner = makeMockRunner(undefined);
    const cursorRunner = makeMockRunner({ raw: "cursor-out", parsed: { success: true } });
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run("cursor", baseInput, "executor", schema);

    expect(result).toEqual({ raw: "cursor-out", parsed: { success: true } });
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    const [routedInput, stageArg] = cursorRunner.run.mock.calls[0]!;
    expect(routedInput).toEqual({ ...baseInput, model: "explicit-model" });
    expect(stageArg).toBe("executor");
  });

  it("throws 'Unknown runtime: ...' for an unrecognized runtime value", async () => {
    const claudeCodeRunner = makeMockRunner(undefined);
    const codexRunner = makeMockRunner(undefined);
    const cursorRunner = makeMockRunner(undefined);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run("bogus-runtime" as unknown as AgentRuntime, baseInput, "planner", schema),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });
});
