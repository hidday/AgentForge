import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ success: z.boolean() });

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue({ raw: "", parsed: {}, success: true }) },
    codexRunner: { run: vi.fn().mockResolvedValue({ raw: "", parsed: {}, success: true }) },
    cursorRunner: { run: vi.fn().mockResolvedValue({ raw: "", parsed: {}, success: true }) },
  };
}

describe("AgentRunner.run()", () => {
  it("routes to claudeCodeRunner for runtime='claude-code'", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await runner.run("claude-code", { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", schema);

    expect(runners.claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to codexRunner for runtime='codex'", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await runner.run("codex", { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "reviewer", schema);

    expect(runners.codexRunner.run).toHaveBeenCalledOnce();
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to cursorRunner for runtime='cursor'", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await runner.run("cursor", { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "executor", schema);

    expect(runners.cursorRunner.run).toHaveBeenCalledOnce();
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime value", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await expect(
      runner.run(
        "not-a-real-runtime" as never,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow(/Unknown runtime/);
  });

  it("uses input.model when provided, without resolving a default", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "custom-model-x" },
      "planner",
      schema,
    );

    const [routedInput] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model-x");
  });

  it("resolves a default model from stage config when input.model is unset", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await runner.run("claude-code", { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", schema);

    const [routedInput] = runners.claudeCodeRunner.run.mock.calls[0]!;
    expect(typeof routedInput.model).toBe("string");
    expect(routedInput.model.length).toBeGreaterThan(0);
  });

  it("logs the routing decision at info level", async () => {
    const runners = makeRunners();
    const logger = makeMockLogger();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      logger as never,
    );

    await runner.run("codex", { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "reviewer", schema);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "codex", stage: "reviewer" }),
      "Routing agent execution",
    );
  });
});
