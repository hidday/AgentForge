import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeRunnerStub(output: AgentOutput) {
  return { run: vi.fn().mockResolvedValue(output) };
}

const schema = z.object({ ok: z.boolean() });

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return { prompt: "do the thing", workingDirectory: "/tmp", timeoutMs: 1000, ...overrides };
}

describe("AgentRunner.run()", () => {
  it("routes claude-code to the ClaudeCodeRunner and resolves its model when none is given", async () => {
    const claudeOutput: AgentOutput = {
      raw: "raw",
      parsed: { ok: true },
      success: true,
      stage: "planner",
      durationMs: 10,
    };
    const claudeCodeRunner = makeRunnerStub(claudeOutput);
    const codexRunner = makeRunnerStub(claudeOutput);
    const cursorRunner = makeRunnerStub(claudeOutput);
    const logger = makeLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run("claude-code", makeInput(), "planner", schema);

    expect(result).toBe(claudeOutput);
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput, stage] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    // "planner" is a lead-tier stage -> CLAUDE_CODE_MODEL
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
    expect(routedInput.prompt).toBe("do the thing");
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("routes codex to the CodexRunner and resolves the review-tier model", async () => {
    const codexOutput: AgentOutput = {
      raw: "raw",
      parsed: { ok: true },
      success: true,
      stage: "plan-reviewer",
      durationMs: 5,
    };
    const claudeCodeRunner = makeRunnerStub(codexOutput);
    const codexRunner = makeRunnerStub(codexOutput);
    const cursorRunner = makeRunnerStub(codexOutput);
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    const result = await agentRunner.run("codex", makeInput(), "plan-reviewer", schema);

    expect(result).toBe(codexOutput);
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CODEX_MODEL);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor to the CursorRunner, resolving the model from the stage's tier", async () => {
    const cursorOutput: AgentOutput = {
      raw: "raw",
      parsed: { ok: true },
      success: true,
      stage: "executor",
      durationMs: 5,
    };
    const claudeCodeRunner = makeRunnerStub(cursorOutput);
    const codexRunner = makeRunnerStub(cursorOutput);
    const cursorRunner = makeRunnerStub(cursorOutput);
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    const result = await agentRunner.run("cursor", makeInput(), "executor", schema);

    expect(result).toBe(cursorOutput);
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput] = cursorRunner.run.mock.calls[0]!;
    // "executor" is lead-tier regardless of which CLI runtime executes it.
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses the caller-provided model instead of resolving a default when input.model is set", async () => {
    const output: AgentOutput = {
      raw: "",
      parsed: { ok: true },
      success: true,
      stage: "planner",
      durationMs: 1,
    };
    const claudeCodeRunner = makeRunnerStub(output);
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      makeRunnerStub(output) as never,
      makeRunnerStub(output) as never,
      makeLogger() as never,
    );

    await agentRunner.run(
      "claude-code",
      makeInput({ model: "custom-override-model" }),
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-override-model");
  });

  it("preserves all other input fields when building the routed input", async () => {
    const output: AgentOutput = {
      raw: "",
      parsed: { ok: true },
      success: true,
      stage: "executor",
      durationMs: 1,
    };
    const claudeCodeRunner = makeRunnerStub(output);
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      makeRunnerStub(output) as never,
      makeRunnerStub(output) as never,
      makeLogger() as never,
    );

    const input = makeInput({
      systemPrompt: "be concise",
      env: { FOO: "bar" },
      runId: "run-42",
    });

    await agentRunner.run("claude-code", input, "executor", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toMatchObject({
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      systemPrompt: "be concise",
      env: { FOO: "bar" },
      runId: "run-42",
      timeoutMs: input.timeoutMs,
    });
  });

  it("throws for an unrecognized runtime value", async () => {
    const output: AgentOutput = {
      raw: "",
      parsed: { ok: true },
      success: true,
      stage: "planner",
      durationMs: 1,
    };
    const agentRunner = new AgentRunner(
      makeRunnerStub(output) as never,
      makeRunnerStub(output) as never,
      makeRunnerStub(output) as never,
      makeLogger() as never,
    );

    await expect(
      // Intentionally bypassing the type system to exercise the exhaustive
      // switch's default branch.
      agentRunner.run("totally-unknown-runtime" as never, makeInput(), "planner", schema),
    ).rejects.toThrow("Unknown runtime: totally-unknown-runtime");
  });

  it("propagates a rejection from the underlying runner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(new Error("cli crashed")) };
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    await expect(
      agentRunner.run("claude-code", makeInput(), "planner", schema),
    ).rejects.toThrow("cli crashed");
  });
});
