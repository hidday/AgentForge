import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentOutput, AgentInput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";
import { z } from "zod";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

function makeOutput(): AgentOutput<{ ok: boolean }> {
  return { raw: "{}", parsed: { ok: true }, success: true, stage: "planner", durationMs: 1 };
}

describe("AgentRunner.run", () => {
  const input: AgentInput = { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000 };

  it("routes to the Claude Code runner and resolves the model via the stage tier when no model override is given", async () => {
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

    const out = await runner.run("claude-code", input, "planner", schema);

    expect(out.parsed.ok).toBe(true);
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput, stage] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(routedInput.model).toBe("claude-fable-5");
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: "claude-fable-5" },
      "Routing agent execution",
    );
  });

  it("preserves an explicit per-call model override instead of resolving one from the stage", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    await runner.run("claude-code", { ...input, model: "custom-model" }, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model");
  });

  it("routes to the Codex runner for the codex runtime", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    await runner.run("codex", input, "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the Cursor runner for the cursor runtime", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    await runner.run("cursor", input, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("throws for an unknown runtime instead of silently dispatching", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    await expect(
      runner.run("totally-unknown" as AgentRuntime, input, "planner", schema),
    ).rejects.toThrow("Unknown runtime: totally-unknown");
  });
});
