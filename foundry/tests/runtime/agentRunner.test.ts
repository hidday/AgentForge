import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ success: z.boolean() });

function makeOutput(stage: string): AgentOutput<{ success: boolean }> {
  return {
    raw: "raw",
    parsed: { success: true },
    success: true,
    // Cast is safe: tests only care about pass-through, not Stage validity.
    stage: stage as never,
    durationMs: 10,
  };
}

const baseInput: AgentInput = {
  prompt: "do it",
  workingDirectory: "/tmp",
  timeoutMs: 1000,
};

describe("AgentRunner.run()", () => {
  let claudeCodeRunner: { run: ReturnType<typeof vi.fn> };
  let codexRunner: { run: ReturnType<typeof vi.fn> };
  let cursorRunner: { run: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeMockLogger>;
  let agentRunner: AgentRunner;

  beforeEach(() => {
    claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput("planner")) };
    codexRunner = { run: vi.fn().mockResolvedValue(makeOutput("reviewer")) };
    cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput("planner")) };
    logger = makeMockLogger();
    agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );
  });

  it("routes to claudeCodeRunner.run for runtime 'claude-code' and forwards stage/schema", async () => {
    const input: AgentInput = { ...baseInput, model: "claude-explicit" };
    const result = await agentRunner.run("claude-code", input, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toMatchObject({ ...input, model: "claude-explicit" });
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(result.parsed).toEqual({ success: true });
  });

  it("routes to codexRunner.run for runtime 'codex'", async () => {
    const input: AgentInput = { ...baseInput, model: "codex-explicit" };
    await agentRunner.run("codex", input, "reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("codex-explicit");
  });

  it("routes to cursorRunner.run for runtime 'cursor'", async () => {
    const input: AgentInput = { ...baseInput, model: "cursor-explicit" };
    await agentRunner.run("cursor", input, "planner", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("resolves the model from stage/env tiering when input.model is not provided", async () => {
    // No explicit model on the input: AgentRunner must fall back to
    // resolveAgentModel(stage, env), which maps the "lead" tier (planner) to
    // env.CLAUDE_CODE_MODEL (default "claude-fable-5" when unset).
    const input: AgentInput = { ...baseInput };
    await agentRunner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBeTruthy();
    expect(typeof routedInput.model).toBe("string");
  });

  it("logs the routing decision before dispatching", async () => {
    await agentRunner.run("claude-code", { ...baseInput, model: "m" }, "planner", schema);

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: "m" },
      "Routing agent execution",
    );
  });

  it("throws on an unknown runtime value", async () => {
    await expect(
      agentRunner.run(
        "not-a-real-runtime" as never,
        { ...baseInput, model: "m" },
        "planner",
        schema,
      ),
    ).rejects.toThrow(/Unknown runtime/);
  });

  it("propagates a rejection from the underlying runner", async () => {
    claudeCodeRunner.run.mockRejectedValueOnce(new Error("boom"));
    await expect(
      agentRunner.run("claude-code", { ...baseInput, model: "m" }, "planner", schema),
    ).rejects.toThrow("boom");
  });
});
