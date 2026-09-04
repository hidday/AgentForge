import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CodexRunner } from "../../src/runtime/codexRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockProcessRunner(result: ProcessResult) {
  return { execute: vi.fn().mockResolvedValue(result) };
}

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const echoSchema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

const validStructuredOutput = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("CodexRunner — arg building and stdin payload branches", () => {
  it("attaches a process context when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-abc" },
      "plan-reviewer",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-abc", stage: "plan-reviewer", runtime: "codex" });
  });

  it("omits the process context when input.runId is unset", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context: unknown };
    expect(context).toBeUndefined();
  });

  it("prepends --model flags directly when baseArgs does not start with 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["--some-flag"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--model", "gpt-5.6-sol", "--some-flag"],
      }),
    );
  });

  it("prepends --model flags when baseArgs is empty", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      [],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol"] }),
    );
  });

  it("inserts --model after the leading 'exec' subcommand when present", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "--extra", "-"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["exec", "--model", "gpt-5.6-sol", "--extra", "-"] }),
    );
  });

  it("prepends the system prompt with a separator when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run(
      {
        prompt: "the actual task",
        systemPrompt: "role instructions",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        stdinData: "role instructions\n\n---\n\nthe actual task",
      }),
    );
  });

  it("uses the prompt as-is for stdin when input.systemPrompt is unset", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "just the task", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "just the task" }),
    );
  });
});
