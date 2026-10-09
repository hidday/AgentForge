import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeFakeOutput(): AgentOutput<unknown> {
  return {
    raw: "raw",
    parsed: { success: true, stage: "planner", payload: { value: "ok" } },
    success: true,
    stage: "planner",
    durationMs: 1,
  };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeFakeOutput()) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeFakeOutput()) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeFakeOutput()) },
  };
}

describe("AgentRunner.run()", () => {
  it("dispatches to claudeCodeRunner for runtime 'claude-code' with the resolved model", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await agentRunner.run("claude-code", input, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    expect(routedInput.model).toBe(resolveAgentModel("planner", env));
    expect(routedInput.prompt).toBe("x");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("dispatches to codexRunner for runtime 'codex' with the resolved model", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "review this", workingDirectory: "/tmp", timeoutMs: 1000 };
    await agentRunner.run("codex", input, "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(resolveAgentModel("plan-reviewer", env));
  });

  it("dispatches to cursorRunner for runtime 'cursor'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await agentRunner.run("cursor", input, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses the caller-supplied model override instead of resolving one from the stage", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = {
      prompt: "x",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-override-model",
    };
    await agentRunner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-override-model");
  });

  it("returns the underlying runner's output", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await agentRunner.run("claude-code", input, "planner", schema);

    expect(result.success).toBe(true);
    expect(result.durationMs).toBe(1);
  });

  it("throws for an unknown runtime", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(
      agentRunner.run("totally-bogus" as never, input, "planner", schema),
    ).rejects.toThrow(/Unknown runtime: totally-bogus/);

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });
});
