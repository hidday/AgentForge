import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const echoSchema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

function makeOutput(): AgentOutput<{ value: string }> {
  return {
    raw: "raw output",
    parsed: { value: "ok" },
    success: true,
    stage: "planner",
    durationMs: 42,
  };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn() },
    codexRunner: { run: vi.fn() },
    cursorRunner: { run: vi.fn() },
  };
}

describe("AgentRunner.run()", () => {
  it("routes claude-code runtime to the ClaudeCodeRunner with a resolved default model", async () => {
    const runners = makeRunners();
    const output = makeOutput();
    runners.claudeCodeRunner.run.mockResolvedValue(output);
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(result).toBe(output);
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, schema] = runners.claudeCodeRunner.run.mock.calls[0]!;
    // "planner" is a "lead" tier stage -> resolves to CLAUDE_CODE_MODEL (default "claude-fable-5").
    expect(routedInput.model).toBe("claude-fable-5");
    expect(routedInput.prompt).toBe("x");
    expect(stage).toBe("planner");
    expect(schema).toBe(echoSchema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner", model: "claude-fable-5" }),
      "Routing agent execution",
    );
  });

  it("routes codex runtime to the CodexRunner with the review-tier model", async () => {
    const runners = makeRunners();
    const output = makeOutput();
    runners.codexRunner.run.mockResolvedValue(output);
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const result = await agentRunner.run(
      "codex",
      { prompt: "review this", workingDirectory: "/tmp", timeoutMs: 1000 },
      "plan-reviewer",
      echoSchema,
    );

    expect(result).toBe(output);
    expect(runners.codexRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput] = runners.codexRunner.run.mock.calls[0]!;
    // "plan-reviewer" is a "review" tier stage -> resolves to CODEX_MODEL (default "gpt-5.6-sol").
    expect(routedInput.model).toBe("gpt-5.6-sol");
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    const runners = makeRunners();
    const output = makeOutput();
    runners.cursorRunner.run.mockResolvedValue(output);
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const result = await agentRunner.run(
      "cursor",
      { prompt: "execute this", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      echoSchema,
    );

    expect(result).toBe(output);
    expect(runners.cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
  });

  it("preserves an explicit input.model instead of resolving a default", async () => {
    const runners = makeRunners();
    const output = makeOutput();
    runners.claudeCodeRunner.run.mockResolvedValue(output);
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    await agentRunner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "custom-model-override" },
      "planner",
      echoSchema,
    );

    const [routedInput] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");
  });

  it("propagates a rejection from the underlying runner without swallowing it", async () => {
    const runners = makeRunners();
    const failure = new Error("boom: subprocess exploded");
    runners.claudeCodeRunner.run.mockRejectedValue(failure);
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    await expect(
      agentRunner.run(
        "claude-code",
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow("boom: subprocess exploded");
  });

  it("throws for an unknown runtime instead of silently dispatching anywhere", async () => {
    const runners = makeRunners();
    const agentRunner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    await expect(
      agentRunner.run(
        "bogus-runtime" as AgentRuntime,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");

    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });
});
