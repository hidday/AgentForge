import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockRunner(output: AgentOutput<{ value: string }>) {
  return { run: vi.fn().mockResolvedValue(output) };
}

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const echoSchema = z.object({ value: z.string() });

const baseInput: AgentInput = {
  prompt: "do the thing",
  workingDirectory: "/tmp/work",
  timeoutMs: 5000,
};

function makeOutput(): AgentOutput<{ value: string }> {
  return {
    raw: "raw output",
    parsed: { value: "ok" },
    success: true,
    stage: "planner",
    durationMs: 42,
  };
}

describe("AgentRunner.run()", () => {
  it("routes claude-code runtime to the ClaudeCodeRunner with a resolved model", async () => {
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run("claude-code", baseInput, "planner", echoSchema);

    expect(result.parsed.value).toBe("ok");
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, schema] = claudeCodeRunner.run.mock.calls[0]!;
    // planner is a "lead" stage -> resolves to CLAUDE_CODE_MODEL default ("claude-fable-5")
    expect(routedInput).toEqual({ ...baseInput, model: "claude-fable-5" });
    expect(stage).toBe("planner");
    expect(schema).toBe(echoSchema);

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: "claude-fable-5" },
      "Routing agent execution",
    );
  });

  it("routes codex runtime to the CodexRunner with the review-tier model", async () => {
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run("codex", baseInput, "plan-reviewer", echoSchema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput] = codexRunner.run.mock.calls[0]!;
    // plan-reviewer is a "review" stage -> resolves to CODEX_MODEL default ("gpt-5.6-sol")
    expect(routedInput.model).toBe("gpt-5.6-sol");
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const result = await agentRunner.run("cursor", baseInput, "executor", echoSchema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(result.parsed.value).toBe("ok");
  });

  it("prefers an explicit input.model over the stage-resolved default", async () => {
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await agentRunner.run(
      "claude-code",
      { ...baseInput, model: "custom-model-override" },
      "planner",
      echoSchema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");
  });

  it("throws for an unknown runtime without calling any sub-runner", async () => {
    const claudeCodeRunner = makeMockRunner(makeOutput());
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      agentRunner.run(
        "bogus-runtime" as unknown as AgentRuntime,
        baseInput,
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the underlying runner", async () => {
    const failure = new Error("runner exploded");
    const claudeCodeRunner = { run: vi.fn().mockRejectedValue(failure) };
    const codexRunner = makeMockRunner(makeOutput());
    const cursorRunner = makeMockRunner(makeOutput());
    const logger = makeMockLogger();
    const agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await expect(
      agentRunner.run("claude-code", baseInput, "planner", echoSchema),
    ).rejects.toThrow("runner exploded");
  });
});
