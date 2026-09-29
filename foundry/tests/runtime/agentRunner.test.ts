import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

const schema = z.object({ value: z.string() });

function makeOutput(stage: string): AgentOutput<{ value: string }> {
  return {
    raw: "raw",
    parsed: { value: "ok" },
    success: true,
    // AgentOutput.stage is typed as Stage but we only care that it round-trips.
    stage: stage as never,
    durationMs: 5,
  };
}

describe("AgentRunner.run", () => {
  it("routes to claudeCodeRunner.run for runtime 'claude-code' with model-resolved input", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput("planner")) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await runner.run("claude-code", input, "planner", schema);

    expect(out.parsed.value).toBe("ok");
    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, routedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(routedSchema).toBe(schema);
    // model defaults from env since input.model was unset (planner is a "lead" stage).
    expect(routedInput.model).toBe("claude-fable-5");
    expect(routedInput.prompt).toBe("hi");
  });

  it("routes to codexRunner.run for runtime 'codex'", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn().mockResolvedValue(makeOutput("plan-reviewer")) };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "review", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await runner.run("codex", input, "plan-reviewer", schema);

    expect(out.parsed.value).toBe("ok");
    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    // plan-reviewer is a "review" tier stage -> CODEX_MODEL default.
    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("gpt-5.6-sol");
  });

  it("routes to cursorRunner.run for runtime 'cursor'", async () => {
    const claudeCodeRunner = { run: vi.fn() };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput("executor")) };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "exec", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await runner.run("cursor", input, "executor", schema);

    expect(out.parsed.value).toBe("ok");
    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("preserves an explicit input.model instead of resolving one from env/stage", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput("planner")) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    const input = {
      prompt: "hi",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-model-override",
    };
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");
  });

  it("logs the routing decision at info level before dispatching", async () => {
    const claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput("planner")) };
    const codexRunner = { run: vi.fn() };
    const cursorRunner = { run: vi.fn() };
    const logger = makeMockLogger();

    const runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("throws for an unknown runtime value", async () => {
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

    const input = { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(
      runner.run("bogus-runtime" as never, input, "planner", schema),
    ).rejects.toThrow(/Unknown runtime: bogus-runtime/);
  });
});
