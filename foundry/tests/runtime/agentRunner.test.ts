import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentRunner } from "../../src/runtime/agentRunner.js";
import { env } from "../../src/config/env.js";
import type { AgentRuntime } from "../../src/domain/types.js";
import type { AgentOutput } from "../../src/runtime/runnerTypes.js";

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeSubRunner(output: AgentOutput<unknown>) {
  return { run: vi.fn().mockResolvedValue(output) };
}

const schema = z.object({ value: z.string() });

function fakeOutput(stage: string): AgentOutput<unknown> {
  return {
    raw: "raw",
    parsed: { value: "ok" },
    success: true,
    stage: stage as never,
    durationMs: 10,
  };
}

describe("AgentRunner.run() dispatch", () => {
  it("routes claude-code runtime to the ClaudeCodeRunner with the caller-supplied model preserved", async () => {
    const claude = makeSubRunner(fakeOutput("planner"));
    const codex = makeSubRunner(fakeOutput("planner"));
    const cursor = makeSubRunner(fakeOutput("planner"));
    const logger = makeLogger();
    const runner = new AgentRunner(claude as never, codex as never, cursor as never, logger as never);

    const input = {
      prompt: "do it",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
      model: "custom-model",
    };

    const result = await runner.run("claude-code", input, "planner", schema);

    expect(claude.run).toHaveBeenCalledTimes(1);
    expect(codex.run).not.toHaveBeenCalled();
    expect(cursor.run).not.toHaveBeenCalled();
    const [routedInput, stage, passedSchema] = claude.run.mock.calls[0]!;
    expect(routedInput).toMatchObject({ prompt: "do it", model: "custom-model" });
    expect(stage).toBe("planner");
    expect(passedSchema).toBe(schema);
    expect(result.parsed).toEqual({ value: "ok" });
  });

  it("routes codex runtime to the CodexRunner", async () => {
    const claude = makeSubRunner(fakeOutput("plan-reviewer"));
    const codex = makeSubRunner(fakeOutput("plan-reviewer"));
    const cursor = makeSubRunner(fakeOutput("plan-reviewer"));
    const logger = makeLogger();
    const runner = new AgentRunner(claude as never, codex as never, cursor as never, logger as never);

    await runner.run(
      "codex",
      { prompt: "review", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
      "plan-reviewer",
      schema,
    );

    expect(codex.run).toHaveBeenCalledTimes(1);
    expect(claude.run).not.toHaveBeenCalled();
    expect(cursor.run).not.toHaveBeenCalled();
  });

  it("routes cursor runtime to the CursorRunner", async () => {
    const claude = makeSubRunner(fakeOutput("executor"));
    const codex = makeSubRunner(fakeOutput("executor"));
    const cursor = makeSubRunner(fakeOutput("executor"));
    const logger = makeLogger();
    const runner = new AgentRunner(claude as never, codex as never, cursor as never, logger as never);

    await runner.run(
      "cursor",
      { prompt: "exec", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
      "executor",
      schema,
    );

    expect(cursor.run).toHaveBeenCalledTimes(1);
    expect(claude.run).not.toHaveBeenCalled();
    expect(codex.run).not.toHaveBeenCalled();
  });

  it("resolves the default model for the stage's tier when the caller supplies no model", async () => {
    const claude = makeSubRunner(fakeOutput("planner"));
    const codex = makeSubRunner(fakeOutput("planner"));
    const cursor = makeSubRunner(fakeOutput("planner"));
    const logger = makeLogger();
    const runner = new AgentRunner(claude as never, codex as never, cursor as never, logger as never);

    // "planner" is a "lead" tier stage -> resolves to env.CLAUDE_CODE_MODEL.
    await runner.run(
      "claude-code",
      { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      schema,
    );

    const [routedInput] = claude.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL);

    const [logFields, logMessage] = logger.info.mock.calls[0]!;
    expect(logMessage).toBe("Routing agent execution");
    expect(logFields).toMatchObject({
      runtime: "claude-code",
      stage: "planner",
      model: env.CLAUDE_CODE_MODEL,
    });
  });

  it("resolves the research-tier model for answer-researcher when no model is supplied", async () => {
    const claude = makeSubRunner(fakeOutput("answer-researcher"));
    const codex = makeSubRunner(fakeOutput("answer-researcher"));
    const cursor = makeSubRunner(fakeOutput("answer-researcher"));
    const logger = makeLogger();
    const runner = new AgentRunner(claude as never, codex as never, cursor as never, logger as never);

    await runner.run(
      "claude-code",
      { prompt: "research", workingDirectory: "/tmp", timeoutMs: 1000 },
      "answer-researcher",
      schema,
    );

    const [routedInput] = claude.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CLAUDE_CODE_MODEL_RESEARCH);
  });

  it("resolves the review-tier model for reviewer when no model is supplied", async () => {
    const claude = makeSubRunner(fakeOutput("reviewer"));
    const codex = makeSubRunner(fakeOutput("reviewer"));
    const cursor = makeSubRunner(fakeOutput("reviewer"));
    const logger = makeLogger();
    const runner = new AgentRunner(claude as never, codex as never, cursor as never, logger as never);

    await runner.run(
      "codex",
      { prompt: "review", workingDirectory: "/tmp", timeoutMs: 1000 },
      "reviewer",
      schema,
    );

    const [routedInput] = codex.run.mock.calls[0]!;
    expect(routedInput.model).toBe(env.CODEX_MODEL);
  });

  it("throws for an unknown runtime instead of silently dispatching", async () => {
    const claude = makeSubRunner(fakeOutput("planner"));
    const codex = makeSubRunner(fakeOutput("planner"));
    const cursor = makeSubRunner(fakeOutput("planner"));
    const logger = makeLogger();
    const runner = new AgentRunner(claude as never, codex as never, cursor as never, logger as never);

    await expect(
      runner.run(
        "bogus-runtime" as AgentRuntime,
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
        "planner",
        schema,
      ),
    ).rejects.toThrow("Unknown runtime: bogus-runtime");

    expect(claude.run).not.toHaveBeenCalled();
    expect(codex.run).not.toHaveBeenCalled();
    expect(cursor.run).not.toHaveBeenCalled();
  });

  it("propagates rejection from the underlying runner without swallowing it", async () => {
    const claude = { run: vi.fn().mockRejectedValue(new Error("cli exploded")) };
    const codex = makeSubRunner(fakeOutput("planner"));
    const cursor = makeSubRunner(fakeOutput("planner"));
    const logger = makeLogger();
    const runner = new AgentRunner(claude as never, codex as never, cursor as never, logger as never);

    await expect(
      runner.run(
        "claude-code",
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "m" },
        "planner",
        schema,
      ),
    ).rejects.toThrow("cli exploded");
  });
});
