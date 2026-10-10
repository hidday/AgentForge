import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import { env } from "../../src/config/env.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockRunner(output: AgentOutput<unknown>) {
  return { run: vi.fn().mockResolvedValue(output) };
}

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

const baseInput: AgentInput = {
  prompt: "do the thing",
  workingDirectory: "/tmp/work",
  timeoutMs: 1000,
};

function makeOutput(): AgentOutput<unknown> {
  return {
    raw: "raw",
    parsed: { success: true, stage: "planner", payload: { value: "ok" } },
    success: true,
    stage: "planner",
    durationMs: 10,
  };
}

describe("AgentRunner.run — dispatch by runtime", () => {
  it("routes claude-code to claudeCodeRunner.run with the resolved default model and leaves other runners untouched", async () => {
    const claudeOutput = makeOutput();
    const claudeCodeRunner = makeMockRunner(claudeOutput);
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run("claude-code", baseInput, "planner", schema);

    expect(result).toBe(claudeOutput);
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toEqual({ ...baseInput, model: resolveAgentModel("planner", env) });
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes codex to codexRunner.run with the resolved default model for its stage tier", async () => {
    const codexOutput = makeOutput();
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(codexOutput);
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run("codex", baseInput, "plan-reviewer", schema);

    expect(result).toBe(codexOutput);
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(resolveAgentModel("plan-reviewer", env));
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor to cursorRunner.run", async () => {
    const cursorOutput = makeOutput();
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(cursorOutput);
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run("cursor", baseInput, "executor", schema);

    expect(result).toBe(cursorOutput);
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput] = cursorRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(resolveAgentModel("executor", env));
  });

  it("passes an explicit input.model through unchanged, overriding the resolved default", async () => {
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "claude-code",
      { ...baseInput, model: "custom-explicit-model" },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-explicit-model");
    // Confirm it did NOT fall back to the resolved default.
    expect(routedInput.model).not.toBe(resolveAgentModel("planner", env));
  });

  it("logs the routing decision with runtime, stage, and model", async () => {
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run("claude-code", { ...baseInput, model: "m1" }, "executor", schema);

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "executor", model: "m1" },
      "Routing agent execution",
    );
  });

  it("throws for an unknown runtime (defensive exhaustiveness branch, reached only by bypassing the type system)", async () => {
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      (agentRunner.run as unknown as (
        runtime: string,
        input: AgentInput,
        stage: string,
        schema: unknown,
      ) => Promise<unknown>)("bogus-runtime", baseInput, "planner", schema),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });
});
