import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentRuntime } from "../../src/domain/types.js";

vi.mock("../../src/config/agentModels.js", () => ({
  resolveAgentModel: vi.fn(() => "resolved-model"),
}));

import { resolveAgentModel } from "../../src/config/agentModels.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn() },
    codexRunner: { run: vi.fn() },
    cursorRunner: { run: vi.fn() },
  };
}

const echoSchema = z.object({ ok: z.boolean() });

describe("AgentRunner.run()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes claude-code and resolves the model via resolveAgentModel when input.model is unset", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    claudeCodeRunner.run.mockResolvedValue({
      raw: "",
      parsed: { ok: true },
      success: true,
      stage: "planner",
      durationMs: 1,
    });
    const logger = makeMockLogger();
    vi.mocked(resolveAgentModel).mockReturnValue("resolved-model");

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const out = await runner.run(
      "claude-code",
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toMatchObject({ prompt: "hi", model: "resolved-model" });
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(echoSchema);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(out.success).toBe(true);
    expect(resolveAgentModel).toHaveBeenCalledWith("planner", expect.anything());
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner", model: "resolved-model" }),
      "Routing agent execution",
    );
  });

  it("uses input.model directly and skips resolveAgentModel when it is already set", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    claudeCodeRunner.run.mockResolvedValue({ success: true });
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000, model: "explicit-model" },
      "planner",
      echoSchema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("explicit-model");
    expect(resolveAgentModel).not.toHaveBeenCalled();
  });

  it("routes codex runtime to the CodexRunner and not the others", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    codexRunner.run.mockResolvedValue({ success: true });
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "codex",
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "reviewer",
      echoSchema,
    );

    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the CursorRunner and not the others", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    cursorRunner.run.mockResolvedValue({ success: true });
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "cursor",
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws a descriptive error for an unknown runtime value instead of silently no-op-ing", async () => {
    const { claudeCodeRunner, codexRunner, cursorRunner } = makeRunners();
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run(
        "unknown-runtime" as AgentRuntime,
        { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow("Unknown runtime: unknown-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });
});
