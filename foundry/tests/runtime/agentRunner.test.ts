import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { CodexRunner } from "../../src/runtime/codexRunner.js";
import type { CursorRunner } from "../../src/runtime/cursorRunner.js";
import type { AgentInput } from "../../src/runtime/runnerTypes.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const schema = z.object({ ok: z.boolean() });

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    prompt: "do the thing",
    workingDirectory: "/tmp/work",
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("AgentRunner", () => {
  let claudeCodeRunner: { run: ReturnType<typeof vi.fn> };
  let codexRunner: { run: ReturnType<typeof vi.fn> };
  let cursorRunner: { run: ReturnType<typeof vi.fn> };
  let runner: AgentRunner;

  beforeEach(() => {
    claudeCodeRunner = { run: vi.fn().mockResolvedValue({ raw: "", parsed: { ok: true }, success: true, stage: "planner", durationMs: 1 }) };
    codexRunner = { run: vi.fn().mockResolvedValue({ raw: "", parsed: { ok: true }, success: true, stage: "plan-reviewer", durationMs: 1 }) };
    cursorRunner = { run: vi.fn().mockResolvedValue({ raw: "", parsed: { ok: true }, success: true, stage: "executor", durationMs: 1 }) };

    runner = new AgentRunner(
      claudeCodeRunner as unknown as ClaudeCodeRunner,
      codexRunner as unknown as CodexRunner,
      cursorRunner as unknown as CursorRunner,
      noopLogger,
    );
  });

  it("routes claude-code runtime to the ClaudeCodeRunner with a resolved model", async () => {
    await runner.run("claude-code", makeInput(), "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    const [input] = claudeCodeRunner.run.mock.calls[0];
    expect(input.model).toBe("claude-fable-5");
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes codex runtime to the CodexRunner", async () => {
    await runner.run("codex", makeInput(), "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    const [input] = codexRunner.run.mock.calls[0];
    expect(input.model).toBe("gpt-5.6-sol");
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    await runner.run("cursor", makeInput(), "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
  });

  it("uses an explicit input.model override instead of resolving one", async () => {
    await runner.run("claude-code", makeInput({ model: "custom-model" }), "planner", schema);

    const [input] = claudeCodeRunner.run.mock.calls[0];
    expect(input.model).toBe("custom-model");
  });

  it("throws on an unknown runtime", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runner.run("bogus" as any, makeInput(), "planner", schema),
    ).rejects.toThrow("Unknown runtime: bogus");
  });
});
