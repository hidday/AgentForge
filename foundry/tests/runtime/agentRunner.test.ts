import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentRuntime } from "../../src/domain/types.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

const echoSchema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeFakeOutput(): AgentOutput<unknown> {
  return {
    raw: "raw",
    parsed: { success: true, stage: "planner", payload: { value: "ok" } },
    success: true,
    stage: "planner",
    durationMs: 10,
  };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeFakeOutput()) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeFakeOutput()) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeFakeOutput()) },
  };
}

const baseInput: AgentInput = {
  prompt: "do the thing",
  workingDirectory: "/tmp",
  timeoutMs: 1000,
};

describe("AgentRunner.run dispatch", () => {
  it("routes 'claude-code' runtime to the claudeCodeRunner with a resolved model", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run("claude-code", baseInput, "planner", echoSchema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, schema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toMatchObject({ prompt: "do the thing", model: "claude-fable-5" });
    expect(stage).toBe("planner");
    expect(schema).toBe(echoSchema);
    expect(result).toEqual(makeFakeOutput());
  });

  it("routes 'codex' runtime to the codexRunner with the review-tier model", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run("codex", baseInput, "reviewer", echoSchema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("gpt-5.6-sol");
  });

  it("routes 'cursor' runtime to the cursorRunner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run("cursor", baseInput, "executor", echoSchema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses an explicit input.model override instead of resolving one from the stage", async () => {
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
      { ...baseInput, model: "custom-model-x" },
      "planner",
      echoSchema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-x");
  });

  it("logs the routing decision with runtime, stage, and resolved model", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run("claude-code", baseInput, "executor", echoSchema);

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "executor", model: "claude-fable-5" },
      "Routing agent execution",
    );
  });

  it("throws a descriptive error for an unknown runtime value", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run("unknown-runtime" as AgentRuntime, baseInput, "planner", echoSchema),
    ).rejects.toThrow("Unknown runtime: unknown-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the underlying runner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    claudeCodeRunner.run.mockRejectedValue(new Error("boom"));
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(runner.run("claude-code", baseInput, "planner", echoSchema)).rejects.toThrow(
      "boom",
    );
  });
});
