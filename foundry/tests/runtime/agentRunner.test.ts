import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

const schema = z.object({ ok: z.boolean() });

function makeRunners() {
  const output: AgentOutput<{ ok: boolean }> = {
    raw: "{}",
    parsed: { ok: true },
    success: true,
    stage: "planner",
    durationMs: 1,
  };
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(output) },
    codexRunner: { run: vi.fn().mockResolvedValue(output) },
    cursorRunner: { run: vi.fn().mockResolvedValue(output) },
  };
}

const baseInput: AgentInput = {
  prompt: "do work",
  workingDirectory: "/repo",
  timeoutMs: 1000,
};

describe("AgentRunner", () => {
  let logger: { info: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    logger = { info: vi.fn() };
  });

  it("routes claude-code runtime to the Claude Code runner with a resolved model", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run("claude-code", baseInput, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    const [calledInput, calledStage] = claudeCodeRunner.run.mock.calls[0];
    expect(calledStage).toBe("planner");
    expect(calledInput.model).toBeDefined();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes codex runtime to the Codex runner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run("codex", baseInput, "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the Cursor runner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run("cursor", baseInput, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("preserves a caller-provided model override instead of resolving a default", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run("claude-code", { ...baseInput, model: "custom-model" }, "planner", schema);

    const [calledInput] = claudeCodeRunner.run.mock.calls[0];
    expect(calledInput.model).toBe("custom-model");
  });

  it("throws for an unknown runtime", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      agentRunner.run("unknown" as never, baseInput, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);
  });
});
