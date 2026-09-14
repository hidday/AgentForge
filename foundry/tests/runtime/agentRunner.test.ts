import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

vi.mock("../../src/config/agentModels.js", () => ({
  resolveAgentModel: vi.fn(() => "resolved-default-model"),
}));

const { resolveAgentModel } = await import("../../src/config/agentModels.js");

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

function makeOutput(): AgentOutput<{ ok: boolean }> {
  return { raw: "{}", parsed: { ok: true }, success: true, stage: "planner", durationMs: 5 };
}

describe("AgentRunner.run()", () => {
  let claudeCodeRunner: { run: ReturnType<typeof vi.fn> };
  let codexRunner: { run: ReturnType<typeof vi.fn> };
  let cursorRunner: { run: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeLogger>;
  let runner: AgentRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAgentModel).mockReturnValue("resolved-default-model");
    claudeCodeRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    codexRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    cursorRunner = { run: vi.fn().mockResolvedValue(makeOutput()) };
    logger = makeLogger();
    runner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );
  });

  it("routes to ClaudeCodeRunner for the claude-code runtime", async () => {
    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    const out = await runner.run("claude-code", input, "planner", schema);

    expect(out.parsed.ok).toBe(true);
    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();

    const [routedInput, stage, passedSchema] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput).toMatchObject({ prompt: "p", model: "resolved-default-model" });
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
  });

  it("routes to CodexRunner for the codex runtime", async () => {
    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("codex", input, "executor", schema);

    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to CursorRunner for the cursor runtime", async () => {
    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("cursor", input, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime", async () => {
    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await expect(
      runner.run("bogus" as never, input, "planner", schema),
    ).rejects.toThrow("Unknown runtime: bogus");
  });

  it("uses input.model when provided, bypassing resolveAgentModel's default", async () => {
    const input = {
      prompt: "p",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "explicit-model",
    };
    await runner.run("claude-code", input, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("explicit-model");
  });

  it("falls back to resolveAgentModel(stage, env) when input.model is unset", async () => {
    vi.mocked(resolveAgentModel).mockReturnValue("stage-default-model");
    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("codex", input, "distillation", schema);

    expect(resolveAgentModel).toHaveBeenCalledWith("distillation", expect.anything());
    const [routedInput] = codexRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("stage-default-model");
  });

  it("logs the routing decision", async () => {
    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };
    await runner.run("claude-code", input, "planner", schema);

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: "resolved-default-model" },
      "Routing agent execution",
    );
  });

  it("propagates a rejection from the underlying runner", async () => {
    claudeCodeRunner.run.mockRejectedValue(new Error("runner blew up"));
    const input = { prompt: "p", workingDirectory: "/tmp", timeoutMs: 1000 };

    await expect(runner.run("claude-code", input, "planner", schema)).rejects.toThrow(
      "runner blew up",
    );
  });
});
