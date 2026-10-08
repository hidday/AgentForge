import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput } from "../../src/runtime/runnerTypes.js";

function makeInput(): AgentInput {
  return {
    prompt: "do the thing",
    workingDirectory: "/tmp/repo",
    timeoutMs: 1000,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

function makeOutput() {
  return { raw: "{}", parsed: { ok: true }, success: true, stage: "planner" as const, durationMs: 10 };
}

describe("AgentRunner", () => {
  it("routes claude-code runtime to the ClaudeCodeRunner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    const result = await runner.run("claude-code", makeInput(), "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(result.parsed).toEqual({ ok: true });
  });

  it("routes codex runtime to the CodexRunner", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run("codex", makeInput(), "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run("cursor", makeInput(), "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("resolves the model from the stage tier when the input has no explicit model", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    await runner.run("claude-code", makeInput(), "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0] as [AgentInput];
    expect(routedInput.model).toBe(process.env.CLAUDE_CODE_MODEL ?? "claude-fable-5");
  });

  it("preserves an explicit per-call model override instead of resolving from the stage", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    await runner.run("claude-code", { ...makeInput(), model: "custom-model" }, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0] as [AgentInput];
    expect(routedInput.model).toBe("custom-model");
  });

  it("logs the routing decision before dispatching", async () => {
    const logger = makeLogger();
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      logger as never,
    );

    await runner.run("claude-code", makeInput(), "planner", schema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("throws for an unknown runtime value", async () => {
    const runner = new AgentRunner(
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    await expect(
      runner.run("unknown-runtime" as never, makeInput(), "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);
  });
});
