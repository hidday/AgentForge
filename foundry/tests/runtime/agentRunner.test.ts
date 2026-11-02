import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeOutput(): AgentOutput<unknown> {
  return { raw: "raw", parsed: {}, success: true, stage: "planner", durationMs: 10 };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
}

const schema = z.object({});
const input: AgentInput = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };

describe("AgentRunner.run", () => {
  it("routes claude-code runtime to the claude code runner", async () => {
    const r = makeRunners();
    const runner = new AgentRunner(
      r.claudeCodeRunner as never,
      r.codexRunner as never,
      r.cursorRunner as never,
      r.logger as never,
    );

    await runner.run("claude-code", input, "planner", schema);

    expect(r.claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "p" }),
      "planner",
      schema,
    );
    expect(r.codexRunner.run).not.toHaveBeenCalled();
    expect(r.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes codex runtime to the codex runner", async () => {
    const r = makeRunners();
    const runner = new AgentRunner(
      r.claudeCodeRunner as never,
      r.codexRunner as never,
      r.cursorRunner as never,
      r.logger as never,
    );

    await runner.run("codex", input, "plan-reviewer", schema);

    expect(r.codexRunner.run).toHaveBeenCalled();
    expect(r.claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the cursor runner", async () => {
    const r = makeRunners();
    const runner = new AgentRunner(
      r.claudeCodeRunner as never,
      r.codexRunner as never,
      r.cursorRunner as never,
      r.logger as never,
    );

    await runner.run("cursor", input, "executor", schema);

    expect(r.cursorRunner.run).toHaveBeenCalled();
  });

  it("uses an explicit model override instead of resolving one from the stage", async () => {
    const r = makeRunners();
    const runner = new AgentRunner(
      r.claudeCodeRunner as never,
      r.codexRunner as never,
      r.cursorRunner as never,
      r.logger as never,
    );

    await runner.run("claude-code", { ...input, model: "custom-model" }, "planner", schema);

    expect(r.claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "custom-model" }),
      "planner",
      schema,
    );
  });

  it("resolves a model from the stage tier when none is given on the input", async () => {
    const r = makeRunners();
    const runner = new AgentRunner(
      r.claudeCodeRunner as never,
      r.codexRunner as never,
      r.cursorRunner as never,
      r.logger as never,
    );

    await runner.run("codex", input, "plan-reviewer", schema);

    const calledWith = r.codexRunner.run.mock.calls[0][0] as AgentInput;
    expect(typeof calledWith.model).toBe("string");
    expect(calledWith.model).not.toBe("");
  });

  it("throws for an unknown runtime", async () => {
    const r = makeRunners();
    const runner = new AgentRunner(
      r.claudeCodeRunner as never,
      r.codexRunner as never,
      r.cursorRunner as never,
      r.logger as never,
    );

    await expect(
      runner.run("unknown-runtime" as never, input, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);
  });
});
