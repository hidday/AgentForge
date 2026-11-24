import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput } from "../../src/runtime/runnerTypes.js";

const schema = z.object({ success: z.boolean() });

function makeRunners() {
  const claudeCodeRunner = { run: vi.fn().mockResolvedValue({ raw: "", parsed: { stage: "planner", payload: { success: true } } }) };
  const codexRunner = { run: vi.fn().mockResolvedValue({ raw: "", parsed: { stage: "reviewer", payload: { success: true } } }) };
  const cursorRunner = { run: vi.fn().mockResolvedValue({ raw: "", parsed: { stage: "executor", payload: { success: true } } }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const runner = new AgentRunner(
    claudeCodeRunner as never,
    codexRunner as never,
    cursorRunner as never,
    logger as never,
  );

  return { runner, claudeCodeRunner, codexRunner, cursorRunner, logger };
}

const baseInput: AgentInput = {
  prompt: "do the thing",
  workingDirectory: "/tmp",
  timeoutMs: 1000,
};

describe("AgentRunner.run()", () => {
  it("routes claude-code runtime to the ClaudeCodeRunner", async () => {
    const { runner, claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();

    await runner.run("claude-code", baseInput, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes codex runtime to the CodexRunner", async () => {
    const { runner, codexRunner } = makeRunners();

    await runner.run("codex", baseInput, "reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    const { runner, cursorRunner } = makeRunners();

    await runner.run("cursor", baseInput, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("throws on an unknown runtime", async () => {
    const { runner } = makeRunners();

    await expect(
      runner.run("bogus" as never, baseInput, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);
  });

  it("resolves a default model from the stage when the input has none", async () => {
    const { runner, claudeCodeRunner } = makeRunners();

    await runner.run("claude-code", baseInput, "planner", schema);

    const [input] = claudeCodeRunner.run.mock.calls[0]!;
    expect((input as AgentInput).model).toBeTruthy();
  });

  it("preserves an explicitly provided model instead of resolving a default", async () => {
    const { runner, claudeCodeRunner } = makeRunners();

    await runner.run("claude-code", { ...baseInput, model: "custom-model" }, "planner", schema);

    const [input] = claudeCodeRunner.run.mock.calls[0]!;
    expect((input as AgentInput).model).toBe("custom-model");
  });

  it("logs the routing decision", async () => {
    const { runner, logger } = makeRunners();

    await runner.run("codex", baseInput, "reviewer", schema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "codex", stage: "reviewer" }),
      "Routing agent execution",
    );
  });
});
