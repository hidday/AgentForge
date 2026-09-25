import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const echoSchema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

function makeOutput(): AgentOutput<unknown> {
  return {
    raw: "raw",
    parsed: { success: true, stage: "planner", payload: { value: "ok" } },
    success: true,
    stage: "planner",
    durationMs: 10,
  };
}

describe("AgentRunner.run()", () => {
  it("routes to the Claude Code runner for runtime 'claude-code' with the resolved model", async () => {
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

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await runner.run("claude-code", input, "planner", echoSchema);

    expect(out).toEqual(makeOutput());
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, schema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toMatchObject({ prompt: "x", model: expect.any(String) });
    expect(stage).toBe("planner");
    expect(schema).toBe(echoSchema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("routes to the Codex runner for runtime 'codex'", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("codex", input, "plan-reviewer", echoSchema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the Cursor runner for runtime 'cursor'", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("cursor", input, "planner", echoSchema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses the per-call model override instead of resolving one from the stage/env", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = {
      prompt: "x",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-model-override",
    };
    await runner.run("claude-code", input, "planner", echoSchema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");
  });

  it("throws for an unknown runtime value", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runner.run("nonexistent-runtime" as any, input, "planner", echoSchema),
    ).rejects.toThrow("Unknown runtime: nonexistent-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });
});
