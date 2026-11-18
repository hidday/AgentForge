import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ success: z.boolean(), stage: z.literal("planner"), payload: z.any() });

function makeOutput(): AgentOutput<unknown> {
  return { raw: "raw", parsed: { ok: true }, success: true, stage: "planner", durationMs: 10 };
}

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000, ...overrides };
}

describe("AgentRunner.run()", () => {
  it("routes to the claude-code runner and fills in the default model when none is given", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const out = await runner.run("claude-code", makeInput(), "planner", schema);

    expect(out).toEqual(makeOutput());
    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
    expect(routedInput.prompt).toBe("do it");
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("preserves an explicit model override instead of resolving a default", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run("claude-code", makeInput({ model: "custom-model" }), "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model");
  });

  it("routes to the codex runner for a 'codex' runtime", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run("codex", makeInput(), "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("routes to the cursor runner for a 'cursor' runtime", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    // Cursor isn't an AGENT_STAGES runtime for any stage, but resolveAgentModel
    // only depends on the stage's tier, not the chosen runtime, so routing
    // cursor against a real stage is a valid way to exercise this branch.
    await runner.run("cursor", makeInput(), "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("propagates rejection from the underlying runner", async () => {
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(new Error("boom")) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(runner.run("claude-code", makeInput(), "planner", schema)).rejects.toThrow(
      "boom",
    );
  });

  it("throws for an unknown runtime (exhaustiveness guard)", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run(
        "not-a-real-runtime" as never,
        makeInput(),
        "planner",
        schema,
      ),
    ).rejects.toThrow(/Unknown runtime/);
  });
});
