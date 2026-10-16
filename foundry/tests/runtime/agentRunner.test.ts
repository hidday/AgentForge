import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeStubRunner(result: unknown) {
  return { run: vi.fn().mockResolvedValue(result) };
}

const schema = z.object({ ok: z.boolean() });
const baseInput: AgentInput = { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000 };

describe("AgentRunner.run()", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes to the Claude Code runner for runtime 'claude-code'", async () => {
    const claudeCodeRunner = makeStubRunner({ parsed: { ok: true } });
    const codexRunner = makeStubRunner({});
    const cursorRunner = makeStubRunner({});
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await runner.run("claude-code", baseInput, "planner", schema);

    expect(result).toEqual({ parsed: { ok: true } });
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    const [routedInput, stage, routedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(routedSchema).toBe(schema);
    expect(routedInput.prompt).toBe("do it");
  });

  it("routes to the Codex runner for runtime 'codex'", async () => {
    const claudeCodeRunner = makeStubRunner({});
    const codexRunner = makeStubRunner({ parsed: { ok: true } });
    const cursorRunner = makeStubRunner({});
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    const result = await runner.run("codex", baseInput, "plan-reviewer", schema);

    expect(result).toEqual({ parsed: { ok: true } });
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the Cursor runner for runtime 'cursor'", async () => {
    const claudeCodeRunner = makeStubRunner({});
    const codexRunner = makeStubRunner({});
    const cursorRunner = makeStubRunner({ parsed: { ok: true } });
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    const result = await runner.run("cursor", baseInput, "reviewer", schema);

    expect(result).toEqual({ parsed: { ok: true } });
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime instead of silently routing anywhere", async () => {
    const claudeCodeRunner = makeStubRunner({});
    const codexRunner = makeStubRunner({});
    const cursorRunner = makeStubRunner({});
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await expect(
      runner.run("not-a-real-runtime" as never, baseInput, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("uses input.model when explicitly provided instead of the resolved default", async () => {
    const claudeCodeRunner = makeStubRunner({});
    const codexRunner = makeStubRunner({});
    const cursorRunner = makeStubRunner({});
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run(
      "claude-code",
      { ...baseInput, model: "custom-model-override" },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");
  });

  it("resolves a default model from the stage tier when input.model is not set", async () => {
    const claudeCodeRunner = makeStubRunner({});
    const codexRunner = makeStubRunner({});
    const cursorRunner = makeStubRunner({});
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await runner.run("claude-code", baseInput, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    // "planner" is a "lead" tier stage -> CLAUDE_CODE_MODEL default.
    expect(routedInput.model).toBe("claude-fable-5");
  });

  it("logs the routing decision with runtime, stage, and resolved model", async () => {
    const claudeCodeRunner = makeStubRunner({});
    const codexRunner = makeStubRunner({});
    const cursorRunner = makeStubRunner({});
    const logger = makeLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run("claude-code", baseInput, "planner", schema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("propagates a rejection from the underlying runner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(new Error("cli exploded")) };
    const codexRunner = makeStubRunner({});
    const cursorRunner = makeStubRunner({});
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await expect(runner.run("claude-code", baseInput, "planner", schema)).rejects.toThrow(
      "cli exploded",
    );
  });
});
