import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { AgentOutput, AgentInput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ success: z.boolean(), stage: z.literal("planner"), payload: z.unknown() });

function makeOutput(): AgentOutput<unknown> {
  return { raw: "raw", parsed: { success: true }, success: true, stage: "planner", durationMs: 1 };
}

describe("AgentRunner.run", () => {
  it("dispatches to claudeCodeRunner.run for runtime 'claude-code', resolving the stage's default model", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input: AgentInput = { prompt: "do the thing", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(result).toEqual(makeOutput());
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0] as [
      AgentInput,
      string,
      unknown,
    ];
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    expect(routedInput.model).toBe(resolveAgentModel("planner", env));
    expect(routedInput.prompt).toBe("do the thing");
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("dispatches to codexRunner.run for runtime 'codex'", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input: AgentInput = { prompt: "review this", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("codex", input, "reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput, stage] = codexRunner.run.mock.calls[0] as [AgentInput, string];
    expect(stage).toBe("reviewer");
    expect(routedInput.model).toBe(resolveAgentModel("reviewer", env));
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("dispatches to cursorRunner.run for runtime 'cursor'", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input: AgentInput = { prompt: "execute this", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("cursor", input, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses input.model as an override instead of the stage's resolved default", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input: AgentInput = {
      prompt: "x",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-override-model",
    };
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0] as [AgentInput];
    expect(routedInput.model).toBe("custom-override-model");
  });

  it("logs the routing decision with runtime, stage, and model", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: resolveAgentModel("planner", env) },
      "Routing agent execution",
    );
  });

  it("rejects with 'Unknown runtime' for an unrecognized runtime value", async () => {
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

    await expect(
      runner.run(
        "bogus-runtime" as unknown as AgentRuntime,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the underlying runner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(new Error("CLI crashed")) };
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
      runner.run(
        "claude-code",
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("CLI crashed");
  });
});
