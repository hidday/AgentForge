import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

const echoSchema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeOutput() {
  return {
    raw: "raw",
    parsed: { success: true, stage: "planner" as const, payload: { value: "ok" } },
    success: true,
    stage: "planner" as const,
    durationMs: 10,
  };
}

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    prompt: "do the thing",
    workingDirectory: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function buildRunner() {
  const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
  const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
  const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
  const logger = makeLogger();

  const runner = new AgentRunner(
    claudeCodeRunner as never,
    codexRunner as never,
    cursorRunner as never,
    logger as never,
  );

  return { runner, claudeCodeRunner, codexRunner, cursorRunner, logger };
}

describe("AgentRunner.run()", () => {
  it("routes 'claude-code' runtime to the ClaudeCodeRunner", async () => {
    const { runner, claudeCodeRunner, codexRunner, cursorRunner } = buildRunner();

    const result = await runner.run("claude-code", makeInput(), "planner", echoSchema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(result.parsed.payload.value).toBe("ok");
  });

  it("routes 'codex' runtime to the CodexRunner", async () => {
    const { runner, claudeCodeRunner, codexRunner, cursorRunner } = buildRunner();

    await runner.run("codex", makeInput(), "reviewer", echoSchema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes 'cursor' runtime to the CursorRunner", async () => {
    const { runner, claudeCodeRunner, codexRunner, cursorRunner } = buildRunner();

    await runner.run("cursor", makeInput(), "executor", echoSchema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime value", async () => {
    const { runner } = buildRunner();

    await expect(
      runner.run("bogus" as AgentRuntime, makeInput(), "planner", echoSchema),
    ).rejects.toThrow(/Unknown runtime: bogus/);
  });

  it("uses input.model when explicitly provided instead of resolving one", async () => {
    const { runner, claudeCodeRunner } = buildRunner();

    await runner.run("claude-code", makeInput({ model: "custom-model" }), "planner", echoSchema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model");
  });

  it("resolves a model from the stage tier when input.model is not provided", async () => {
    const { runner, codexRunner } = buildRunner();

    await runner.run("codex", makeInput(), "plan-reviewer", echoSchema);

    const [routedInput] = codexRunner.run.mock.calls[0]!;
    // plan-reviewer is a "review" tier stage, routed to the Codex model.
    expect(typeof routedInput.model).toBe("string");
    expect(routedInput.model.length).toBeGreaterThan(0);
  });

  it("logs the routing decision with runtime, stage, and resolved model", async () => {
    const { runner, logger } = buildRunner();

    await runner.run("claude-code", makeInput({ model: "m1" }), "executor", echoSchema);

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "executor", model: "m1" },
      "Routing agent execution",
    );
  });

  it("preserves the rest of the input fields while injecting the model", async () => {
    const { runner, claudeCodeRunner } = buildRunner();
    const input = makeInput({ systemPrompt: "sys", runId: "run-9" });

    await runner.run("claude-code", input, "planner", echoSchema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.prompt).toBe(input.prompt);
    expect(routedInput.systemPrompt).toBe("sys");
    expect(routedInput.runId).toBe("run-9");
    expect(routedInput.workingDirectory).toBe("/tmp");
  });
});
