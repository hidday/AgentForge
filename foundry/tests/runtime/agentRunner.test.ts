import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

const resolveAgentModelMock = vi.fn((..._args: unknown[]) => "resolved-model");

vi.mock("../../src/config/agentModels.js", () => ({
  resolveAgentModel: (...args: unknown[]) => resolveAgentModelMock(...args),
}));

function makeMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ value: z.string() });

function makeOutput(stage: string): AgentOutput<{ value: string }> {
  return {
    raw: "raw",
    parsed: { value: "ok" },
    success: true,
    // Stage is loosely typed in runnerTypes as the cliProtocol Stage; cast
    // through unknown is unnecessary here since callers only read it back.
    stage: stage as never,
    durationMs: 10,
  };
}

const baseInput: AgentInput = {
  prompt: "do the thing",
  workingDirectory: "/tmp/work",
  timeoutMs: 5000,
};

describe("AgentRunner.run() dispatch", () => {
  let claudeCodeRunner: { run: ReturnType<typeof vi.fn> };
  let codexRunner: { run: ReturnType<typeof vi.fn> };
  let cursorRunner: { run: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeMockLogger>;
  let agentRunner: AgentRunner;

  beforeEach(() => {
    resolveAgentModelMock.mockClear();
    resolveAgentModelMock.mockReturnValue("resolved-model");
    claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput("planner")) };
    codexRunner = { run: vi.fn().mockResolvedValue(makeOutput("plan-reviewer")) };
    cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput("executor")) };
    logger = makeMockLogger();
    agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );
  });

  it("routes 'claude-code' to the ClaudeCodeRunner and returns its result verbatim", async () => {
    const expected = makeOutput("planner");
    claudeCodeRunner.run.mockResolvedValue(expected);

    const result = await agentRunner.run(
      "claude-code",
      { ...baseInput, model: "explicit-model" },
      "planner",
      schema,
    );

    expect(result).toBe(expected);
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ ...baseInput, model: "explicit-model" }),
      "planner",
      schema,
    );
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes 'codex' to the CodexRunner and returns its result verbatim", async () => {
    const expected = makeOutput("plan-reviewer");
    codexRunner.run.mockResolvedValue(expected);

    const result = await agentRunner.run(
      "codex",
      { ...baseInput, model: "explicit-model" },
      "plan-reviewer",
      schema,
    );

    expect(result).toBe(expected);
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "explicit-model" }),
      "plan-reviewer",
      schema,
    );
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes 'cursor' to the CursorRunner and returns its result verbatim", async () => {
    const expected = makeOutput("executor");
    cursorRunner.run.mockResolvedValue(expected);

    const result = await agentRunner.run(
      "cursor",
      { ...baseInput, model: "explicit-model" },
      "executor",
      schema,
    );

    expect(result).toBe(expected);
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(cursorRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "explicit-model" }),
      "executor",
      schema,
    );
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown/unsupported runtime without calling any underlying runner", async () => {
    await expect(
      agentRunner.run(
        "bogus-runtime" as never,
        { ...baseInput, model: "x" },
        "planner",
        schema,
      ),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("resolves the model from resolveAgentModel when input.model is not provided", async () => {
    await agentRunner.run("claude-code", { ...baseInput }, "planner", schema);

    expect(resolveAgentModelMock).toHaveBeenCalledWith("planner", expect.anything());
    expect(claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "resolved-model" }),
      "planner",
      schema,
    );
  });

  it("bypasses resolveAgentModel entirely when input.model is explicitly provided", async () => {
    await agentRunner.run(
      "claude-code",
      { ...baseInput, model: "caller-supplied-model" },
      "planner",
      schema,
    );

    expect(resolveAgentModelMock).not.toHaveBeenCalled();
    expect(claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "caller-supplied-model" }),
      "planner",
      schema,
    );
  });

  it("logs the routing decision with runtime, stage and resolved model", async () => {
    await agentRunner.run(
      "codex",
      { ...baseInput, model: "explicit-model" },
      "plan-reviewer",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "codex", stage: "plan-reviewer", model: "explicit-model" },
      "Routing agent execution",
    );
  });

  it("preserves all other input fields unchanged while only overriding model", async () => {
    const input: AgentInput = {
      prompt: "p",
      systemPrompt: "sys",
      workingDirectory: "/wd",
      env: { X: "1" },
      timeoutMs: 999,
      runId: "run-123",
    };

    await agentRunner.run("cursor", input, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledWith(
      {
        prompt: "p",
        systemPrompt: "sys",
        workingDirectory: "/wd",
        env: { X: "1" },
        timeoutMs: 999,
        runId: "run-123",
        model: "resolved-model",
      },
      "executor",
      schema,
    );
  });

  it("propagates a rejection from the underlying runner", async () => {
    const failure = new Error("boom from claude-code runner");
    claudeCodeRunner.run.mockRejectedValue(failure);

    await expect(
      agentRunner.run("claude-code", { ...baseInput, model: "m" }, "planner", schema),
    ).rejects.toBe(failure);
  });
});
