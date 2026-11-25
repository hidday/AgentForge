import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

const schema = z.object({ success: z.boolean() });

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeAgentOutput(): AgentOutput<{ success: boolean }> {
  return {
    raw: "raw output",
    parsed: { success: true },
    success: true,
    stage: "planner",
    durationMs: 10,
  };
}

const baseInput: AgentInput = {
  prompt: "do the task",
  workingDirectory: "/tmp",
  timeoutMs: 1000,
};

describe("AgentRunner.run", () => {
  let claudeCodeRunner: { run: ReturnType<typeof vi.fn> };
  let codexRunner: { run: ReturnType<typeof vi.fn> };
  let cursorRunner: { run: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeMockLogger>;
  let runner: AgentRunner;

  beforeEach(() => {
    claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeAgentOutput()) };
    codexRunner = { run: vi.fn().mockResolvedValue(makeAgentOutput()) };
    cursorRunner = { run: vi.fn().mockResolvedValue(makeAgentOutput()) };
    logger = makeMockLogger();
    runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );
  });

  it("routes to claudeCodeRunner.run for runtime 'claude-code'", async () => {
    const out = await runner.run("claude-code", baseInput, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(out.parsed).toEqual({ success: true });

    const [input, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0];
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    expect(input.prompt).toBe("do the task");
  });

  it("routes to codexRunner.run for runtime 'codex'", async () => {
    await runner.run("codex", baseInput, "executor", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to cursorRunner.run for runtime 'cursor'", async () => {
    await runner.run("cursor", baseInput, "reviewer", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime", async () => {
    await expect(
      runner.run("not-a-real-runtime" as never, baseInput, "planner", schema),
    ).rejects.toThrow("Unknown runtime: not-a-real-runtime");
  });

  it("preserves an explicit model override on the input instead of resolving a default", async () => {
    await runner.run(
      "claude-code",
      { ...baseInput, model: "explicit-model" },
      "planner",
      schema,
    );

    const [input] = claudeCodeRunner.run.mock.calls[0];
    expect(input.model).toBe("explicit-model");
  });

  it("resolves a default model from stage/env when the input has none", async () => {
    await runner.run("claude-code", baseInput, "planner", schema);

    const [input] = claudeCodeRunner.run.mock.calls[0];
    // The default model is resolved by resolveAgentModel(stage, env); we only
    // assert that routing fills in *some* model rather than leaving it unset,
    // since the exact default is an implementation detail of agentModels.ts.
    expect(typeof input.model).toBe("string");
    expect(input.model!.length).toBeGreaterThan(0);
  });

  it("logs the routing decision with runtime, stage and model", async () => {
    await runner.run("codex", baseInput, "executor", schema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "codex", stage: "executor" }),
      "Routing agent execution",
    );
  });

  it("propagates a rejection from the underlying runner", async () => {
    claudeCodeRunner.run.mockRejectedValue(new Error("subprocess failed"));

    await expect(runner.run("claude-code", baseInput, "planner", schema)).rejects.toThrow(
      "subprocess failed",
    );
  });
});
