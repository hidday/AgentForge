import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentRuntime } from "../../src/domain/types.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

const schema = z.object({ value: z.string() });

function makeOutput(stage: string): AgentOutput<{ value: string }> {
  return {
    raw: "raw",
    parsed: { value: "ok" },
    success: true,
    stage: stage as never,
    durationMs: 10,
  };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeOutput("planner")) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeOutput("plan-reviewer")) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeOutput("executor")) },
  };
}

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe("AgentRunner.run routing", () => {
  it("routes claude-code runtime to the ClaudeCodeRunner with the resolved default model", async () => {
    const runners = makeRunners();
    const logger = makeLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const out = await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(out.parsed.value).toBe("ok");
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    const [input] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(input.model).toBe(env.CLAUDE_CODE_MODEL);
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes codex runtime to the CodexRunner", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "plan-reviewer",
      schema,
    );

    expect(runners.codexRunner.run).toHaveBeenCalledTimes(1);
    const [input] = runners.codexRunner.run.mock.calls[0]!;
    expect(input.model).toBe(env.CODEX_MODEL);
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run(
      "cursor",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      schema,
    );

    expect(runners.cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("preserves a caller-supplied model override instead of resolving the default", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "custom-model" },
      "planner",
      schema,
    );

    const [input] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(input.model).toBe("custom-model");
  });

  it("throws for an unknown runtime", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeLogger() as never,
    );

    await expect(
      runner.run(
        "unknown-runtime" as unknown as AgentRuntime,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow(/Unknown runtime/);
  });
});
