import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CursorRunner } from "../../src/runtime/cursorRunner.js";
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

describe("CursorRunner — stdin payload and args branches", () => {
  it("attaches a process context when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.7-opus",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/work", timeoutMs: 1000, runId: "run-abc" },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-abc", stage: "planner", runtime: "cursor" });
  });

  it("omits the process context when input.runId is unset", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.7-opus",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/work", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context: unknown };
    expect(context).toBeUndefined();
  });

  it("prepends the system prompt with a separator when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.7-opus",
      makeMockLogger() as never,
    );

    await runner.run(
      {
        prompt: "the actual task",
        systemPrompt: "role instructions",
        workingDirectory: "/work",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        stdinData: "role instructions\n\n---\n\nthe actual task",
        args: expect.arrayContaining(["--workspace", "/work"]),
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
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.7-opus",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "just the task", workingDirectory: "/work", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "just the task" }),
    );
  });

  it("truncates a long outputSnippet to a tail with an ellipsis prefix when logging a non-zero exit", async () => {
    const longResult = "R".repeat(900) + "[END_MARKER]";
    const envelope = JSON.stringify({ type: "result", result: longResult });

    const processRunner = makeMockProcessRunner({
      stdout: envelope,
      stderr: "",
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.7-opus",
      logger as never,
    );

    await expect(
      runner.run(
        { prompt: "x", workingDirectory: "/work", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[END_MARKER]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
  });

  it("truncates long stderr to a tail with an ellipsis prefix when logging a non-zero exit", async () => {
    const longStderr = "S".repeat(700) + "[STDERR_END]";
    const processRunner = makeMockProcessRunner({
      stdout: "panic: unrecoverable",
      stderr: longStderr,
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.7-opus",
      logger as never,
    );

    await expect(
      runner.run(
        { prompt: "x", workingDirectory: "/work", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.stderr.startsWith("…")).toBe(true);
    expect(logFields.stderr).toContain("[STDERR_END]");
    expect(logFields.stderr.length).toBeLessThanOrEqual(501);
  });
});
