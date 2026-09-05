import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import * as agentModels from "../../src/config/agentModels.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeAgentOutput(): AgentOutput<{ value: string }> {
  return {
    raw: "raw",
    parsed: { value: "ok" },
    success: true,
    stage: "planner",
    durationMs: 10,
  };
}

const schema = z.object({ value: z.string() });

describe("AgentRunner.run", () => {
  it("routes to ClaudeCodeRunner for the claude-code runtime, resolving the model when unset", async () => {
    const resolveSpy = vi.spyOn(agentModels, "resolveAgentModel").mockReturnValue("resolved-model");
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeAgentOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(resolveSpy).toHaveBeenCalledWith("planner", expect.anything());
    expect(claudeCodeRunner.run).toHaveBeenCalledWith(
      { ...input, model: "resolved-model" },
      "planner",
      schema,
    );
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(result.parsed.value).toBe("ok");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner", model: "resolved-model" }),
      "Routing agent execution",
    );

    resolveSpy.mockRestore();
  });

  it("routes to CodexRunner for the codex runtime", async () => {
    const codexRunner = { run: vi.fn().mockResolvedValue(makeAgentOutput()) };
    const claudeCodeRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "gpt-explicit" };
    await runner.run("codex", input, "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledWith(
      { ...input, model: "gpt-explicit" },
      "plan-reviewer",
      schema,
    );
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to CursorRunner for the cursor runtime", async () => {
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeAgentOutput()) };
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("cursor", input, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses input.model when provided instead of resolving a default", async () => {
    const resolveSpy = vi.spyOn(agentModels, "resolveAgentModel");
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeAgentOutput()) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "pinned-model" };
    await runner.run("claude-code", input, "planner", schema);

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "pinned-model" }),
      "planner",
      schema,
    );

    resolveSpy.mockRestore();
  });

  it("throws for an unknown/unsupported runtime value", async () => {
    const runner = new AgentRunner(
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(
      runner.run("not-a-real-runtime" as never, input, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);
  });

  it("propagates a rejection from the underlying runner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(new Error("cli exploded")) };
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    await expect(
      runner.run(
        "claude-code",
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("cli exploded");
  });
});
