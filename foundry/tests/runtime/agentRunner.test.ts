import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput } from "../../src/runtime/runnerTypes.js";
import type { AgentRuntime } from "../../src/domain/types.js";

const resolveAgentModelMock = vi.fn();

vi.mock("../../src/config/agentModels.js", () => ({
  resolveAgentModel: (...args: unknown[]) => resolveAgentModelMock(...args),
}));

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ ok: z.boolean() });

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    prompt: "do the thing",
    workingDirectory: "/tmp/work",
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("AgentRunner.run()", () => {
  let claudeCodeRunner: { run: ReturnType<typeof vi.fn> };
  let codexRunner: { run: ReturnType<typeof vi.fn> };
  let cursorRunner: { run: ReturnType<typeof vi.fn> };
  let logger: ReturnType<typeof makeLogger>;
  let agentRunner: AgentRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    claudeCodeRunner = { run: vi.fn().mockResolvedValue({ raw: "claude", parsed: { ok: true }, success: true, stage: "planner", durationMs: 1 }) };
    codexRunner = { run: vi.fn().mockResolvedValue({ raw: "codex", parsed: { ok: true }, success: true, stage: "planner", durationMs: 1 }) };
    cursorRunner = { run: vi.fn().mockResolvedValue({ raw: "cursor", parsed: { ok: true }, success: true, stage: "planner", durationMs: 1 }) };
    logger = makeLogger();
    resolveAgentModelMock.mockReturnValue("resolved-model");
    agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );
  });

  it("routes 'claude-code' to claudeCodeRunner.run with the routed input", async () => {
    const input = makeInput({ model: "explicit-model" });
    const result = await agentRunner.run("claude-code", input, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.run).toHaveBeenCalledWith(
      { ...input, model: "explicit-model" },
      "planner",
      schema,
    );
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
    expect(result.raw).toBe("claude");
  });

  it("routes 'codex' to codexRunner.run with the routed input", async () => {
    const input = makeInput({ model: "explicit-model" });
    await agentRunner.run("codex", input, "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledTimes(1);
    expect(codexRunner.run).toHaveBeenCalledWith(
      { ...input, model: "explicit-model" },
      "plan-reviewer",
      schema,
    );
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes 'cursor' to cursorRunner.run with the routed input", async () => {
    const input = makeInput({ model: "explicit-model" });
    await agentRunner.run("cursor", input, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledTimes(1);
    expect(cursorRunner.run).toHaveBeenCalledWith(
      { ...input, model: "explicit-model" },
      "executor",
      schema,
    );
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("resolves the model via resolveAgentModel when input.model is unset", async () => {
    const input = makeInput();
    delete input.model;

    await agentRunner.run("claude-code", input, "executor", schema);

    expect(resolveAgentModelMock).toHaveBeenCalledTimes(1);
    expect(resolveAgentModelMock).toHaveBeenCalledWith("executor", expect.anything());
    expect(claudeCodeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "resolved-model" }),
      "executor",
      schema,
    );
  });

  it("does not call resolveAgentModel when input.model is already set", async () => {
    const input = makeInput({ model: "caller-supplied" });

    await agentRunner.run("codex", input, "reviewer", schema);

    expect(resolveAgentModelMock).not.toHaveBeenCalled();
    expect(codexRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "caller-supplied" }),
      "reviewer",
      schema,
    );
  });

  it("logs the routing decision", async () => {
    const input = makeInput({ model: "m1" });
    await agentRunner.run("claude-code", input, "planner", schema);

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "claude-code", stage: "planner", model: "m1" },
      "Routing agent execution",
    );
  });

  it("throws on an unknown runtime value (exhaustiveness default branch)", async () => {
    const input = makeInput({ model: "m1" });
    const bogusRuntime = "not-a-real-runtime" as unknown as AgentRuntime;

    await expect(agentRunner.run(bogusRuntime, input, "planner", schema)).rejects.toThrow(
      "Unknown runtime: not-a-real-runtime",
    );
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("propagates a rejection from the routed runner", async () => {
    const failure = new Error("cli exploded");
    claudeCodeRunner.run.mockRejectedValueOnce(failure);

    await expect(
      agentRunner.run("claude-code", makeInput({ model: "m1" }), "planner", schema),
    ).rejects.toThrow("cli exploded");
  });
});
