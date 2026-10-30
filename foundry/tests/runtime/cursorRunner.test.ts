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
});

describe("CursorRunner.buildArgs / buildStdinPayload / tailSnippet", () => {
  const validBlock = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;
  const okStdout = JSON.stringify({ type: "result", result: validBlock });

  it("passes --model and --workspace to the CLI", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: okStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      ["--flag"],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/work/dir", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toEqual(["--flag", "--model", "claude-4.6-sonnet", "--workspace", "/work/dir"]);
  });

  it("prepends the system prompt to stdin, separated from the task prompt", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: okStdout,
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
        systemPrompt: "You are a helpful reviewer.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are a helpful reviewer.\n\n---\n\ndo the task");
  });

  it("uses the prompt verbatim as stdin when no system prompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: okStdout,
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

    await runner.run({ prompt: "just the task", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("just the task");
  });

  it("truncates a very long output snippet to its tail with an ellipsis prefix", async () => {
    const longOutput = "Z".repeat(900) + "[TAIL_MARKER]";
    const processRunner = makeMockProcessRunner({
      stdout: longOutput,
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
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[TAIL_MARKER]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
  });

  it("includes a context object when input.runId is set, omits it otherwise", async () => {
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-42" },
      "planner",
      echoSchema,
    );
    const { context: withRunId } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(withRunId).toEqual({ runId: "run-42", stage: "planner", runtime: "cursor" });

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);
    const { context: withoutRunId } = processRunner.execute.mock.calls[1]![0] as {
      context?: unknown;
    };
    expect(withoutRunId).toBeUndefined();
  });
});
