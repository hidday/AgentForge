import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import type { AgentInput } from "../../src/runtime/runnerTypes.js";

function makeRunnerStub() {
  return { run: vi.fn().mockResolvedValue({ raw: "", parsed: {}, success: true }) };
}

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const schema = z.object({ value: z.string() });

const baseInput: AgentInput = {
  prompt: "do something",
  workingDirectory: "/tmp",
  timeoutMs: 1000,
};

describe("AgentRunner.run", () => {
  let claudeCodeRunner: ReturnType<typeof makeRunnerStub>;
  let codexRunner: ReturnType<typeof makeRunnerStub>;
  let cursorRunner: ReturnType<typeof makeRunnerStub>;
  let logger: ReturnType<typeof makeLogger>;
  let agentRunner: AgentRunner;

  beforeEach(() => {
    claudeCodeRunner = makeRunnerStub();
    codexRunner = makeRunnerStub();
    cursorRunner = makeRunnerStub();
    logger = makeLogger();
    agentRunner = new AgentRunner(
      claudeCodeRunner as never,
      codexRunner as never,
      cursorRunner as never,
      logger as never,
    );
  });

  it("routes to the Claude Code runner for runtime 'claude-code'", async () => {
    await agentRunner.run("claude-code", baseInput, "planner", schema);

    expect(claudeCodeRunner.run).toHaveBeenCalledOnce();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the Codex runner for runtime 'codex'", async () => {
    await agentRunner.run("codex", baseInput, "plan-reviewer", schema);

    expect(codexRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("routes to the Cursor runner for runtime 'cursor'", async () => {
    await agentRunner.run("cursor", baseInput, "executor", schema);

    expect(cursorRunner.run).toHaveBeenCalledOnce();
    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
  });

  it("throws for an unknown runtime instead of silently routing", async () => {
    await expect(
      agentRunner.run("not-a-real-runtime" as never, baseInput, "planner", schema),
    ).rejects.toThrow(/Unknown runtime/);

    expect(claudeCodeRunner.run).not.toHaveBeenCalled();
    expect(codexRunner.run).not.toHaveBeenCalled();
    expect(cursorRunner.run).not.toHaveBeenCalled();
  });

  it("passes the per-call model override through unchanged when provided", async () => {
    await agentRunner.run(
      "claude-code",
      { ...baseInput, model: "explicit-model" },
      "planner",
      schema,
    );

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(routedInput.model).toBe("explicit-model");
  });

  it("resolves a default model from stage config when none is provided on the input", async () => {
    await agentRunner.run("claude-code", baseInput, "planner", schema);

    const [routedInput] = claudeCodeRunner.run.mock.calls[0]!;
    expect(typeof routedInput.model).toBe("string");
    expect(routedInput.model.length).toBeGreaterThan(0);
  });

  it("logs the routing decision with runtime, stage, and resolved model", async () => {
    await agentRunner.run("codex", { ...baseInput, model: "my-model" }, "plan-reviewer", schema);

    expect(logger.info).toHaveBeenCalledWith(
      { runtime: "codex", stage: "plan-reviewer", model: "my-model" },
      "Routing agent execution",
    );
  });

  it("forwards the stage and schema arguments to the resolved runner", async () => {
    await agentRunner.run("cursor", baseInput, "reviewer", schema);

    const [, stage, forwardedSchema] = cursorRunner.run.mock.calls[0]!;
    expect(stage).toBe("reviewer");
    expect(forwardedSchema).toBe(schema);
  });
});
