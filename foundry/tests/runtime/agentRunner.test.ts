import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ value: z.string() });

function makeOutput(stage: string): AgentOutput<{ value: string }> {
  return {
    raw: "raw",
    parsed: { value: "ok" },
    success: true,
    stage: stage as never,
    durationMs: 5,
  };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeOutput("planner")) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeOutput("plan-reviewer")) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeOutput("planner")) },
  };
}

describe("AgentRunner.run() — routing", () => {
  it("routes to the claudeCodeRunner for runtime 'claude-code' and passes the resolved model through", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "do x", workingDirectory: "/tmp", timeoutMs: 1000, model: "my-model" };
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(runners.claudeCodeRunner.run).toHaveBeenCalledWith(
      { ...input, model: "my-model" },
      "planner",
      schema,
    );
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
    expect(result.parsed.value).toBe("ok");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner", model: "my-model" }),
      "Routing agent execution",
    );
  });

  it("routes to the codexRunner for runtime 'codex'", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "review x", workingDirectory: "/tmp", timeoutMs: 1000, model: "gpt" };
    await runner.run("codex", input, "plan-reviewer", schema);

    expect(runners.codexRunner.run).toHaveBeenCalledWith(
      { ...input, model: "gpt" },
      "plan-reviewer",
      schema,
    );
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the cursorRunner for runtime 'cursor'", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "cursor-model" };
    await runner.run("cursor", input, "planner", schema);

    expect(runners.cursorRunner.run).toHaveBeenCalledWith(
      { ...input, model: "cursor-model" },
      "planner",
      schema,
    );
  });

  it("resolves a default model via resolveAgentModel when input.model is not provided", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("claude-code", input, "planner", schema);

    const [passedInput] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(typeof passedInput.model).toBe("string");
    expect(passedInput.model.length).toBeGreaterThan(0);
  });

  it("throws for an unknown runtime value", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" };
    await expect(
      runner.run("not-a-real-runtime" as never, input, "planner", schema),
    ).rejects.toThrow("Unknown runtime: not-a-real-runtime");
  });
});
