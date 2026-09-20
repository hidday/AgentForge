import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const echoSchema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

const sampleOutput: AgentOutput<{ success: boolean; stage: "planner"; payload: { value: string } }> = {
  raw: "raw output",
  parsed: { success: true, stage: "planner", payload: { value: "ok" } },
  success: true,
  stage: "planner",
  durationMs: 42,
};

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn() },
    codexRunner: { run: vi.fn() },
    cursorRunner: { run: vi.fn() },
  };
}

describe("AgentRunner.run() dispatch", () => {
  it("dispatches to claudeCodeRunner and returns its result for runtime 'claude-code'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    claudeCodeRunner.run.mockResolvedValue(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run(
      "claude-code",
      { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000, model: "m1" },
      "planner",
      echoSchema,
    );

    expect(result).toBe(sampleOutput);
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, schemaArg] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toMatchObject({ prompt: "do it", model: "m1" });
    expect(stage).toBe("planner");
    expect(schemaArg).toBe(echoSchema);
  });

  it("dispatches to codexRunner and returns its result for runtime 'codex'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    codexRunner.run.mockResolvedValue(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run(
      "codex",
      { prompt: "review it", workingDirectory: "/tmp", timeoutMs: 1000, model: "m2" },
      "plan-reviewer",
      echoSchema,
    );

    expect(result).toBe(sampleOutput);
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("dispatches to cursorRunner and returns its result for runtime 'cursor'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    cursorRunner.run.mockResolvedValue(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run(
      "cursor",
      { prompt: "cursor go", workingDirectory: "/tmp", timeoutMs: 1000, model: "m3" },
      "executor",
      echoSchema,
    );

    expect(result).toBe(sampleOutput);
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("resolves the model from stage config via resolveAgentModel when input.model is not provided", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    claudeCodeRunner.run.mockResolvedValue(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "no model given", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    // "planner" is a lead-tier stage -> resolves to env.CLAUDE_CODE_MODEL
    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner", model: env.CLAUDE_CODE_MODEL }),
      "Routing agent execution",
    );
  });

  it("throws for an unknown runtime and does not invoke any runner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run(
        "not-a-real-runtime" as never,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m1" },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow("Unknown runtime: not-a-real-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("logs routing info with runtime, stage and resolved model before dispatching", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    codexRunner.run.mockResolvedValue(sampleOutput);
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "explicit-model" },
      "reviewer",
      echoSchema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "codex", stage: "reviewer", model: "explicit-model" },
      "Routing agent execution",
    );
  });
});
