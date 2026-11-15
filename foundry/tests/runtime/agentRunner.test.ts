import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("../../src/config/agentModels.js", () => ({
  resolveAgentModel: vi.fn(() => "resolved-model"),
}));

import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { resolveAgentModel } from "../../src/config/agentModels.js";

const schema = z.object({ success: z.boolean() });

function makeSubRunner() {
  return { run: vi.fn().mockResolvedValue({ parsed: { success: true }, raw: {} }) };
}

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe("AgentRunner.run()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes claude-code runtime to the ClaudeCodeRunner with the resolved input", async () => {
    const claudeCodeRunner = makeSubRunner();
    const codexRunner = makeSubRunner();
    const cursorRunner = makeSubRunner();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "do x", workingDirectory: "/tmp", timeoutMs: 1000, model: "explicit-model" };
    const result = await runner.run("claude-code", input, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    const [routedInput, stage, usedSchema] = claudeCodeRunner.run.mock.calls[0];
    expect(routedInput).toMatchObject({ ...input, model: "explicit-model" });
    expect(stage).toBe("planner");
    expect(usedSchema).toBe(schema);
    expect(result).toEqual({ parsed: { success: true }, raw: {} });
  });

  it("routes codex runtime to the CodexRunner", async () => {
    const claudeCodeRunner = makeSubRunner();
    const codexRunner = makeSubRunner();
    const cursorRunner = makeSubRunner();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
      "reviewer",
      schema,
    );

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    const claudeCodeRunner = makeSubRunner();
    const codexRunner = makeSubRunner();
    const cursorRunner = makeSubRunner();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "cursor",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
      "executor",
      schema,
    );

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("resolves the model from stage/env when input.model is not provided", async () => {
    const claudeCodeRunner = makeSubRunner();
    const codexRunner = makeSubRunner();
    const cursorRunner = makeSubRunner();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(resolveAgentModel).toHaveBeenCalledWith("planner", expect.anything());
    const [routedInput] = claudeCodeRunner.run.mock.calls[0];
    expect(routedInput.model).toBe("resolved-model");
  });

  it("logs runtime/stage/model before dispatching", async () => {
    const claudeCodeRunner = makeSubRunner();
    const codexRunner = makeSubRunner();
    const cursorRunner = makeSubRunner();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
      "executor",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "executor", model: "m" },
      "Routing agent execution",
    );
  });

  it("throws for an unknown runtime", async () => {
    const claudeCodeRunner = makeSubRunner();
    const codexRunner = makeSubRunner();
    const cursorRunner = makeSubRunner();
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run(
        "bogus-runtime" as never,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
        "planner",
        schema,
      ),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");
  });
});
