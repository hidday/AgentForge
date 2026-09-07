import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { z } from "zod";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeRunnerMock(output: AgentOutput<unknown>) {
  return { run: vi.fn().mockResolvedValue(output) };
}

const schema = z.object({ value: z.string() });
const baseInput: AgentInput = { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000 };

describe("AgentRunner.run", () => {
  it("routes to claudeCodeRunner for the 'claude-code' runtime", async () => {
    const output: AgentOutput<unknown> = {
      raw: "{}",
      parsed: { value: "ok" },
      success: true,
      stage: "planner",
      durationMs: 10,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = makeRunnerMock(output);
    const cursorRunner = makeRunnerMock(output);
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run("claude-code", baseInput, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(result).toBe(output);
  });

  it("routes to codexRunner for the 'codex' runtime", async () => {
    const output: AgentOutput<unknown> = {
      raw: "{}",
      parsed: { value: "ok" },
      success: true,
      stage: "reviewer",
      durationMs: 10,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = makeRunnerMock(output);
    const cursorRunner = makeRunnerMock(output);
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run("codex", baseInput, "reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to cursorRunner for the 'cursor' runtime", async () => {
    const output: AgentOutput<unknown> = {
      raw: "{}",
      parsed: { value: "ok" },
      success: true,
      stage: "executor",
      durationMs: 10,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = makeRunnerMock(output);
    const cursorRunner = makeRunnerMock(output);
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run("cursor", baseInput, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime value", async () => {
    const output: AgentOutput<unknown> = {
      raw: "{}",
      parsed: { value: "ok" },
      success: true,
      stage: "planner",
      durationMs: 10,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = makeRunnerMock(output);
    const cursorRunner = makeRunnerMock(output);
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      // @ts-expect-error deliberately passing an invalid runtime to exercise the default branch
      runner.run("bogus-runtime", baseInput, "planner", schema),
    ).rejects.toThrow(/Unknown runtime: bogus-runtime/);
  });

  it("uses input.model when explicitly provided instead of resolving from env", async () => {
    const output: AgentOutput<unknown> = {
      raw: "{}",
      parsed: { value: "ok" },
      success: true,
      stage: "planner",
      durationMs: 10,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = makeRunnerMock(output);
    const cursorRunner = makeRunnerMock(output);
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run("claude-code", { ...baseInput, model: "custom-model-x" }, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-x");
  });

  it("resolves the default model for the stage's tier when input.model is omitted", async () => {
    const output: AgentOutput<unknown> = {
      raw: "{}",
      parsed: { value: "ok" },
      success: true,
      stage: "reviewer",
      durationMs: 10,
    };
    const claudeCodeRunner = makeRunnerMock(output);
    const codexRunner = makeRunnerMock(output);
    const cursorRunner = makeRunnerMock(output);
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    // "reviewer" is a "review" tier stage -> resolves to CODEX_MODEL default (gpt-5.6-sol)
    await runner.run("codex", baseInput, "reviewer", schema);

    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("gpt-5.6-sol");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "codex", stage: "reviewer", model: "gpt-5.6-sol" }),
      "Routing agent execution",
    );
  });
});
