import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import type { AgentInput, AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

function makeOutput(): AgentOutput<{ ok: boolean }> {
  return {
    raw: "{}",
    parsed: { ok: true },
    success: true,
    stage: "planner",
    durationMs: 1,
  };
}

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    prompt: "do the thing",
    workingDirectory: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeOutput()) },
  };
}

describe("AgentRunner.run()", () => {
  it("dispatches to claudeCodeRunner for runtime 'claude-code' with the resolved model", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = makeInput();
    const out = await runner.run("claude-code", input, "planner", schema);

    const expectedModel = resolveAgentModel("planner", env);
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ ...input, model: expectedModel }),
      "planner",
      schema,
    );
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
    expect(out).toEqual(makeOutput());
  });

  it("dispatches to codexRunner for runtime 'codex' with the resolved model", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = makeInput();
    await runner.run("codex", input, "reviewer", schema);

    const expectedModel = resolveAgentModel("reviewer", env);
    expect(runners.codexRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.codexRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: expectedModel }),
      "reviewer",
      schema,
    );
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("dispatches to cursorRunner for runtime 'cursor' with the resolved model", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = makeInput();
    await runner.run("cursor", input, "executor", schema);

    const expectedModel = resolveAgentModel("executor", env);
    expect(runners.cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.cursorRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: expectedModel }),
      "executor",
      schema,
    );
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
  });

  it("uses an explicit input.model instead of the resolved default", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const explicitModel = "my-custom-model";
    const input = makeInput({ model: explicitModel });
    await runner.run("claude-code", input, "planner", schema);

    const resolvedDefault = resolveAgentModel("planner", env);
    expect(explicitModel).not.toBe(resolvedDefault);
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: explicitModel }),
      "planner",
      schema,
    );
  });

  it("throws for an unknown runtime", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run("bogus-runtime" as never, makeInput(), "planner", schema),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");

    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });
});
