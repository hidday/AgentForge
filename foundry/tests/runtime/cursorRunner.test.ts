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

describe("CursorRunner.run() error reporting", () => {
  it("logs an outputSnippet from the unwrapped envelope on non-zero exit with no structured output", async () => {
    const envelope = JSON.stringify({
      type: "result",
      result: "Cursor reported: rate limit exceeded for org=acme",
    });

    const processRunner = makeMockProcessRunner({
      stdout: envelope,
      stderr: "",
      exitCode: 1,
      durationMs: 1000,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      logger as never,
    );

    await expect(
      runner.run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logFields, logMessage] = logger.error.mock.calls[0]!;
    expect(logMessage).toBe(
      "Cursor CLI returned non-zero exit code with no structured output",
    );
    expect(logFields).toMatchObject({ stage: "planner", exitCode: 1, stderr: "" });
    expect(logFields.outputSnippet).toContain("rate limit exceeded for org=acme");
  });

  it("falls back to raw stdout in the snippet when output is not a JSON envelope", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "panic: model unavailable",
      stderr: "",
      exitCode: 1,
      durationMs: 50,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      logger as never,
    );

    await expect(
      runner.run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet).toContain("panic: model unavailable");
  });

  it("does not log an error when output contains BEGIN_STRUCTURED_OUTPUT", async () => {
    const validBlock = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validBlock }),
      stderr: "",
      exitCode: 1,
      durationMs: 50,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      logger as never,
    );

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(out.parsed.payload.value).toBe("ok");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("truncates a long stderr/outputSnippet to a tail with an ellipsis prefix in the error log", async () => {
    const longResult = "X".repeat(900) + "[TAIL_MARKER]";
    const longStderr = "A".repeat(700) + "[STDERR_TAIL]";
    const envelope = JSON.stringify({ type: "result", result: longResult });

    const processRunner = makeMockProcessRunner({
      stdout: envelope,
      stderr: longStderr,
      exitCode: 1,
      durationMs: 100,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      logger as never,
    );

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[TAIL_MARKER]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
    expect(logFields.stderr.startsWith("…")).toBe(true);
    expect(logFields.stderr).toContain("[STDERR_TAIL]");
    expect(logFields.stderr.length).toBeLessThanOrEqual(501);
  });
});

describe("CursorRunner.buildStdinPayload() — system prompt handling", () => {
  it("prepends the system prompt separated from the user prompt when provided", async () => {
    const validBlock = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validBlock }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      {
        prompt: "do the task",
        systemPrompt: "You are a helpful agent.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "You are a helpful agent.\n\n---\n\ndo the task" }),
    );
  });

  it("uses the prompt verbatim when no system prompt is provided", async () => {
    const validBlock = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validBlock }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run({ prompt: "just this", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "just this" }),
    );
  });
});

describe("CursorRunner — process context propagation", () => {
  it("passes a context with runId/stage/runtime when input.runId is set", async () => {
    const validBlock = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validBlock }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-abc" },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { runId: "run-abc", stage: "planner", runtime: "cursor" },
      }),
    );
  });
});
