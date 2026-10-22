import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ value: z.string() });

function makeOutput(): AgentOutput<{ value: string }> {
  return { raw: "raw", parsed: { value: "ok" }, success: true, stage: "planner", durationMs: 1 };
}

describe("AgentRunner.run()", () => {
  it("routes claude-code runtime to the ClaudeCodeRunner with a resolved model", async () => {
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

    const out = await runner.run(
      "claude-code",
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(out.parsed.value).toBe("ok");
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    // Falls back to env.CLAUDE_CODE_MODEL when no explicit model is given.
    expect(routedInput.model).toBeTruthy();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("routes codex runtime to the CodexRunner and preserves an explicit model override", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    await runner.run(
      "codex",
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000, model: "custom-model" },
      "plan-reviewer",
      schema,
    );

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model");
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    const out = await runner.run(
      "cursor",
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      schema,
    );

    expect(out.success).toBe(true);
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime", async () => {
    const runner = new AgentRunner(
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeMockLogger() as never,
    );

    await expect(
      runner.run(
        "bogus-runtime" as never,
        { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow(/Unknown runtime: bogus-runtime/);
  });

  it("propagates a rejection from the underlying runner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(new Error("boom")) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeMockLogger() as never,
    );

    await expect(
      runner.run(
        "claude-code",
        { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("boom");
  });
});
