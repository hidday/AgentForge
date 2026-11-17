import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ value: z.string() });

function makeOutput(stage: "planner" | "executor" | "remediation"): AgentOutput<{ value: string }> {
  return {
    raw: "{}",
    parsed: { value: "ok" },
    success: true,
    stage,
    durationMs: 10,
  };
}

describe("AgentRunner.run routing", () => {
  let claudeCodeRunner: { run: ReturnType<typeof vi.fn> };
  let codexRunner: { run: ReturnType<typeof vi.fn> };
  let cursorRunner: { run: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeLogger>;
  let runner: AgentRunner;

  beforeEach(() => {
    claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput("planner")) };
    codexRunner = { run: vi.fn().mockResolvedValue(makeOutput("planner")) };
    cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput("planner")) };
    logger = makeLogger();
    runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );
  });

  it("routes claude-code runtime to the ClaudeCodeRunner and returns its output", async () => {
    const out = await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );
    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(out.parsed).toEqual({ value: "ok" });
  });

  it("routes codex runtime to the CodexRunner", async () => {
    await runner.run(
      "codex",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "reviewer",
      schema,
    );
    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    await runner.run(
      "cursor",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );
    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime value instead of silently no-op'ing", async () => {
    await expect(
      runner.run(
        "bogus-runtime" as never,
        { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");
  });

  it("uses input.model when explicitly provided instead of resolving a default", async () => {
    await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000, model: "custom-model" },
      "planner",
      schema,
    );
    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model");
  });

  it("resolves a default model via resolveAgentModel when input.model is omitted", async () => {
    await runner.run(
      "claude-code",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );
    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(typeof routedInput.model).toBe("string");
    expect(routedInput.model.length).toBeGreaterThan(0);
  });

  it("logs the routing decision with runtime, stage, and resolved model", async () => {
    await runner.run(
      "codex",
      { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 },
      "reviewer",
      schema,
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "codex", stage: "reviewer" }),
      "Routing agent execution",
    );
  });
});
