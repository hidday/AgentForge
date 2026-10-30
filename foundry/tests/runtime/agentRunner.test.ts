import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeOutput(): AgentOutput<{ ok: boolean }> {
  return { raw: "{}", parsed: { ok: true }, success: true, stage: "planner", durationMs: 10 };
}

const schema = z.object({ ok: z.boolean() });
const input: AgentInput = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };

describe("AgentRunner.run()", () => {
  it("routes claude-code runtime to ClaudeCodeRunner.run with a resolved model", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const out = await runner.run("claude-code", input, "planner", schema);

    expect(out.parsed.ok).toBe(true);
    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(routedInput.model).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("routes codex runtime to CodexRunner.run", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run("codex", input, "executor", schema);

    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to CursorRunner.run", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run("cursor", input, "reviewer", schema);

    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses input.model verbatim when provided, bypassing resolveAgentModel's default", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run(
      "claude-code",
      { ...input, model: "explicit-model-override" },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("explicit-model-override");
  });

  it("throws for an unknown runtime value", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await expect(
      runner.run("not-a-real-runtime" as never, input, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);
  });
});
