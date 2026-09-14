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

  it("truncates a very long stderr and outputSnippet to a tail with an ellipsis prefix", async () => {
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

const validCursorEnvelope = JSON.stringify({
  type: "result",
  result: `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`,
});

describe("CursorRunner.run() process context", () => {
  it("passes a context object with runId/stage/runtime when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validCursorEnvelope,
      stderr: "",
      exitCode: 0,
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

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-321" },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toEqual({ runId: "run-321", stage: "planner", runtime: "cursor" });
  });

  it("passes context=undefined when input.runId is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validCursorEnvelope,
      stderr: "",
      exitCode: 0,
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

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toBeUndefined();
  });
});

describe("CursorRunner argument and stdin building", () => {
  it("includes --model and --workspace in the built args", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validCursorEnvelope,
      stderr: "",
      exitCode: 0,
      durationMs: 50,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      ["--print"],
      "claude-4.6-sonnet",
      logger as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/workspace/repo", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toEqual(["--print", "--model", "claude-4.6-sonnet", "--workspace", "/workspace/repo"]);
  });

  it("prepends the system prompt to stdin ahead of the user prompt when systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validCursorEnvelope,
      stderr: "",
      exitCode: 0,
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

    await runner.run(
      { prompt: "Do the task.", systemPrompt: "You are a planner.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are a planner.\n\n---\n\nDo the task.");
  });

  it("uses the prompt alone as stdin when systemPrompt is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validCursorEnvelope,
      stderr: "",
      exitCode: 0,
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

    await runner.run({ prompt: "Do the task.", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("Do the task.");
  });
});
