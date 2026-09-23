import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { resolveAgentModel } from "../../src/config/agentModels.js";
import { env } from "../../src/config/env.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue({ raw: "claude", parsed: { ok: true } }) },
    codexRunner: { run: vi.fn().mockResolvedValue({ raw: "codex", parsed: { ok: true } }) },
    cursorRunner: { run: vi.fn().mockResolvedValue({ raw: "cursor", parsed: { ok: true } }) },
  };
}

describe("AgentRunner.run()", () => {
  it("routes to claudeCodeRunner for the claude-code runtime", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await runner.run("claude-code", input, "planner", schema);

    expect(out.raw).toBe("claude");
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, passedSchema] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    // model was not provided on input, so it must be resolved from env for the stage
    expect(routedInput.model).toBe(resolveAgentModel("planner", env));
    // original input fields are preserved
    expect(routedInput.prompt).toBe("do it");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "claude-code", stage: "planner" }),
      "Routing agent execution",
    );
  });

  it("routes to codexRunner for the codex runtime", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "review it", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await runner.run("codex", input, "plan-reviewer", schema);

    expect(out.raw).toBe("codex");
    expect(runners.codexRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to cursorRunner for the cursor runtime", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = { prompt: "fix it", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await runner.run("cursor", input, "planner", schema);

    expect(out.raw).toBe("cursor");
    expect(runners.cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
  });

  it("preserves an explicit input.model instead of resolving one from env", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    const input = {
      prompt: "do it",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-model-override",
    };
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-override");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ model: "custom-model-override" }),
      "Routing agent execution",
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

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };

    await expect(
      runner.run("not-a-real-runtime" as AgentRuntime, input, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);

    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });
});
