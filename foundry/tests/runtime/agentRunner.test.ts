import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";
import { z } from "zod";

const schema = z.object({ ok: z.boolean() });

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeOutput(): AgentOutput<{ ok: boolean }> {
  return { raw: "raw", parsed: { ok: true }, success: true, stage: "executor", durationMs: 10 };
}

const baseInput: AgentInput = {
  prompt: "do it",
  workingDirectory: "/tmp",
  timeoutMs: 1000,
};

describe("AgentRunner.run", () => {
  let claudeCodeRunner: { run: ReturnType<typeof vi.fn> };
  let codexRunner: { run: ReturnType<typeof vi.fn> };
  let cursorRunner: { run: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeLogger>;
  let runner: AgentRunner;

  beforeEach(() => {
    claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    logger = makeLogger();
    runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );
  });

  it("routes 'claude-code' runtime to claudeCodeRunner.run and not the others", async () => {
    const result = await runner.run("claude-code", baseInput, "executor", schema);
    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(result.parsed.ok).toBe(true);
  });

  it("routes 'codex' runtime to codexRunner.run and not the others", async () => {
    await runner.run("codex", baseInput, "plan-reviewer", schema);
    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes 'cursor' runtime to cursorRunner.run and not the others", async () => {
    await runner.run("cursor", baseInput, "executor", schema);
    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses input.model when explicitly provided, instead of resolving one from the stage tier", async () => {
    await runner.run(
      "claude-code",
      { ...baseInput, model: "explicit-model" },
      "executor",
      schema,
    );
    const [calledInput] = claudeCodeRunner.run.mock.calls[0] as [AgentInput];
    expect(calledInput.model).toBe("explicit-model");
  });

  it("resolves a model from the stage's tier when input.model is not provided", async () => {
    await runner.run("claude-code", baseInput, "executor", schema);
    const [calledInput] = claudeCodeRunner.run.mock.calls[0] as [AgentInput];
    // 'executor' is a 'lead' tier stage -> CLAUDE_CODE_MODEL
    expect(calledInput.model).toBe(env.CLAUDE_CODE_MODEL);
  });

  it("throws for an unknown runtime value", async () => {
    await expect(
      runner.run("not-a-real-runtime" as never, baseInput, "executor", schema),
    ).rejects.toThrow(/Unknown runtime/);
  });

  it("logs the routing decision with runtime, stage, and resolved model", async () => {
    await runner.run("codex", baseInput, "plan-reviewer", schema);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "codex", stage: "plan-reviewer" }),
      "Routing agent execution",
    );
  });
});
