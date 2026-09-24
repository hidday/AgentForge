import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

function makeOutput(): AgentOutput<unknown> {
  return {
    raw: "raw",
    parsed: { success: true, stage: "planner", payload: { value: "ok" } },
    success: true,
    stage: "planner",
    durationMs: 10,
  };
}

describe("AgentRunner.run()", () => {
  let claudeCodeRunner: { run: ReturnType<typeof vi.fn> };
  let codexRunner: { run: ReturnType<typeof vi.fn> };
  let cursorRunner: { run: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeMockLogger>;
  let runner: AgentRunner;

  beforeEach(() => {
    claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    logger = makeMockLogger();
    runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );
  });

  it("routes to claudeCodeRunner for runtime 'claude-code' and returns its result", async () => {
    const out = await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(out).toEqual(makeOutput());
  });

  it("routes to codexRunner for runtime 'codex'", async () => {
    await runner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "plan-reviewer",
      schema,
    );

    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to cursorRunner for runtime 'cursor'", async () => {
    await runner.run(
      "cursor",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      schema,
    );

    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws on an unknown runtime (exhaustiveness check)", async () => {
    await expect(
      runner.run(
        "totally-unknown-runtime" as never,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("Unknown runtime: totally-unknown-runtime");

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("resolves the model from resolveAgentModel when input.model is not set", async () => {
    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);
  });

  it("uses codex's review-tier model default for a review stage when input.model is not set", async () => {
    await runner.run(
      "codex",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "reviewer",
      schema,
    );

    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("preserves an explicit input.model instead of resolving one", async () => {
    await runner.run(
      "claude-code",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "custom-model" },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("custom-model");
  });

  it("logs the routing decision", async () => {
    await runner.run(
      "cursor",
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      schema,
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "cursor", stage: "executor" }),
      "Routing agent execution",
    );
  });

  it("propagates a rejection from the routed runner", async () => {
    claudeCodeRunner.run.mockRejectedValueOnce(new Error("boom"));

    await expect(
      runner.run(
        "claude-code",
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        schema,
      ),
    ).rejects.toThrow("boom");
  });
});
