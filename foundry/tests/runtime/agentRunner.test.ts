import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import { z } from "zod";

const schema = z.object({ success: z.boolean(), stage: z.literal("planner"), payload: z.unknown() });

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeOutput(stage: "planner" = "planner"): AgentOutput<unknown> {
  return { raw: "raw", parsed: { ok: true }, success: true, stage, durationMs: 10 };
}

describe("AgentRunner.run", () => {
  it("routes claude-code runtime to claudeCodeRunner.run with a model resolved from env/stage", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeLogger();

    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(result.parsed).toEqual({ ok: true });
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, usedSchema] = claudeCodeRunner.run.mock.calls[0] as [
      { prompt: string; model?: string },
      string,
      unknown,
    ];
    expect(routedInput.prompt).toBe("x");
    expect(typeof routedInput.model).toBe("string");
    expect(routedInput.model!.length).toBeGreaterThan(0);
    expect(stage).toBe("planner");
    expect(usedSchema).toBe(schema);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("routes codex runtime to codexRunner.run", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const cursorRunner = { run: vi.fn() };
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await agentRunner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "reviewer",
      schema,
    );

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to cursorRunner.run", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      makeLogger() as never,
    );

    await agentRunner.run(
      "cursor",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      schema,
    );

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("uses input.model override instead of resolving from env/stage when provided", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    await agentRunner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "my-custom-model" },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0] as [{ model?: string }];
    expect(routedInput.model).toBe("my-custom-model");
  });

  it("throws for an unknown runtime value", async () => {
    const agentRunner = new AgentRunner(
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    await expect(
      agentRunner.run(
        "bogus-runtime" as never,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow(/Unknown runtime/);
  });

  it("propagates rejection from the underlying runner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(new Error("boom")) };
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      { run: vi.fn() } as never,
      { run: vi.fn() } as never,
      makeLogger() as never,
    );

    await expect(
      agentRunner.run(
        "claude-code",
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("boom");
  });
});
