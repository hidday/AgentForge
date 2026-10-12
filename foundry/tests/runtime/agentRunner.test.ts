import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeOutput(): AgentOutput {
  return { raw: "raw", parsed: { ok: true }, success: true, stage: "planner", durationMs: 10 };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
  };
}

describe("AgentRunner.run", () => {
  it("routes to the ClaudeCodeRunner for runtime 'claude-code'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(result).toEqual(makeOutput());

    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    // planner is a "lead" tier stage -> resolves to env.CLAUDE_CODE_MODEL when no override given
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
    expect(routedInput.prompt).toBe("p");
  });

  it("routes to the CodexRunner for runtime 'codex'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("codex", input, "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage] = codexRunner.run.mock.calls[0]!;
    expect(stage).toBe("plan-reviewer");
    // plan-reviewer is a "review" tier stage -> resolves to env.CODEX_MODEL
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("routes to the CursorRunner for runtime 'cursor'", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("cursor", input, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("preserves a caller-supplied model override instead of resolving one from the stage", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = {
      prompt: "p",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-model-override",
    };
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");
  });

  it("logs the routing decision with runtime, stage, and resolved model", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: env.CLAUDE_CODE_MODEL },
      "Routing agent execution",
    );
  });

  it("throws a descriptive error for an unrecognized runtime value", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    const bogusRuntime = "bogus-runtime" as unknown as AgentRuntime;

    await expect(runner.run(bogusRuntime, input, "planner", schema)).rejects.toThrow(
      "Unknown runtime: bogus-runtime",
    );

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the underlying runner", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    claudeCodeRunner.run.mockRejectedValueOnce(new Error("boom"));
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run(
        "claude-code",
        { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("boom");
  });
});
