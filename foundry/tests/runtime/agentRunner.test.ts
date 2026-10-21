import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeOutput(stage: string): AgentOutput<{ ok: boolean }> {
  return {
    raw: "{}",
    parsed: { ok: true },
    success: true,
    stage: stage as never,
    durationMs: 10,
  };
}

const schema = z.object({ ok: z.boolean() });

function makeRunners() {
  return {
    claudeCodeRunner: { run: vi.fn().mockResolvedValue(makeOutput("planner")) },
    codexRunner: { run: vi.fn().mockResolvedValue(makeOutput("reviewer")) },
    cursorRunner: { run: vi.fn().mockResolvedValue(makeOutput("executor")) },
  };
}

describe("AgentRunner.run", () => {
  it("routes claude-code runtime to claudeCodeRunner with the resolved lead model", async () => {
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

    expect(out.parsed).toEqual({ ok: true });
    expect(runners.claudeCodeRunner.run).toHaveBeenCalledWith(
      { ...input, model: env.CLAUDE_CODE_MODEL },
      "planner",
      schema,
    );
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: env.CLAUDE_CODE_MODEL },
      "Routing agent execution",
    );
  });

  it("resolves the research-tier model for a research stage", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "research", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("claude-code", input, "answer-researcher", schema);

    expect(runners.claudeCodeRunner.run).toHaveBeenCalledWith(
      { ...input, model: env.CLAUDE_CODE_MODEL_RESEARCH },
      "answer-researcher",
      schema,
    );
  });

  it("routes codex runtime to codexRunner with the review-tier model", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "review", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await runner.run("codex", input, "reviewer", schema);

    expect(out.stage).toBe("reviewer");
    expect(runners.codexRunner.run).toHaveBeenCalledWith(
      { ...input, model: env.CODEX_MODEL },
      "reviewer",
      schema,
    );
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to cursorRunner", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "execute", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("cursor", input, "executor", schema);

    expect(runners.cursorRunner.run).toHaveBeenCalledWith(
      { ...input, model: env.CLAUDE_CODE_MODEL },
      "executor",
      schema,
    );
    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
  });

  it("keeps an explicit input.model override instead of resolving one from the stage tier", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = {
      prompt: "x",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-override-model",
    };
    await runner.run("claude-code", input, "planner", schema);

    expect(runners.claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "custom-override-model" }),
      "planner",
      schema,
    );
  });

  it("throws for an unknown runtime instead of silently dispatching", async () => {
    const runners = makeRunners();
    const runner = new AgentRunner(
      runners.claudeCodeRunner as never,
      runners.codexRunner as never,
      runners.cursorRunner as never,
      makeMockLogger() as never,
    );

    const input = { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(
      runner.run("not-a-real-runtime" as AgentRuntime, input, "planner", schema),
    ).rejects.toThrow("Unknown runtime: not-a-real-runtime");

    expect(runners.claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(runners.codexRunner.run).not.toHaveBeenCalled();
    expect(runners.cursorRunner.run).not.toHaveBeenCalled();
  });
});
