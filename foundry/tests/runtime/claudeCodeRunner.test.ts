import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

function makeMockProcessRunner(result: ProcessResult) {
  return {
    execute: vi.fn().mockResolvedValue(result),
  };
}

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

const echoSchema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

const validStructuredOutput = `Some preamble text.

BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT
`;

describe("ClaudeCodeRunner.run() error reporting", () => {
  it("logs upstreamApiError=true with the unwrapped result text when CLI returns is_error envelope", async () => {
    // Reproduces the real-world failure mode we hit on plan-reviser:
    //   exitCode 1, empty stderr, stdout = JSON envelope where is_error: true
    //   and `result` is "API Error: Stream idle timeout - partial response received".
    // Without the fix, the only log line was "non-zero exit code with no
    // structured output" with stderr: "" — leaving no hint of the real cause.
    const apiErrorEnvelope = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "API Error: Stream idle timeout - partial response received",
    });

    const processRunner = makeMockProcessRunner({
      stdout: apiErrorEnvelope,
      stderr: "",
      exitCode: 1,
      durationMs: 244_664,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      logger as never,
    );

    await expect(
      runner.run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "plan-reviser",
        echoSchema,
      ),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logFields, logMessage] = logger.error.mock.calls[0]!;
    expect(logMessage).toBe("Claude Code CLI reported upstream API error");
    expect(logFields).toMatchObject({
      stage: "plan-reviser",
      exitCode: 1,
      stderr: "",
      upstreamApiError: true,
    });
    expect(logFields.outputSnippet).toContain(
      "API Error: Stream idle timeout - partial response received",
    );
  });

  it("logs the generic error with outputSnippet when exit is non-zero but envelope is_error is absent/false", async () => {
    const benignEnvelope = JSON.stringify({
      type: "result",
      result: "Model produced no structured output, just chatty text.",
    });

    const processRunner = makeMockProcessRunner({
      stdout: benignEnvelope,
      stderr: "warning: deprecated flag",
      exitCode: 2,
      durationMs: 100,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
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
      "Claude Code CLI returned non-zero exit code with no structured output",
    );
    expect(logFields).toMatchObject({
      stage: "planner",
      exitCode: 2,
      stderr: "warning: deprecated flag",
    });
    expect(logFields.outputSnippet).toContain("Model produced no structured output");
    expect(logFields.upstreamApiError).toBeUndefined();
  });

  it("truncates very long stderr and outputSnippet to a tail with an ellipsis prefix", async () => {
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
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
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
    // Snippet starts with the ellipsis sentinel, ends with the actual tail.
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[TAIL_MARKER]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
    expect(logFields.stderr.startsWith("…")).toBe(true);
    expect(logFields.stderr).toContain("[STDERR_TAIL]");
    expect(logFields.stderr.length).toBeLessThanOrEqual(501);
  });

  it("does not log an error when exitCode is 0 and structured output is present", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 50,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      logger as never,
    );

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(out.success).toBe(true);
    expect(out.parsed.payload.value).toBe("ok");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not log an error when exitCode is non-zero but a structured output block is recoverable", async () => {
    // A common pattern: model produced a valid structured block but the CLI
    // exited non-zero for unrelated reasons (post-write hook, etc.).
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 1,
      durationMs: 50,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
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

describe("ClaudeCodeRunner.run() — args and NDJSON envelope handling", () => {
  it("includes --system-prompt and the runId context when both are provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      ["--output-format", "json"],
      "claude-opus-4-8",
      logger as never,
    );

    await runner.run(
      {
        prompt: "x",
        systemPrompt: "You are a careful planner.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
        runId: "run-123",
      },
      "planner",
      echoSchema,
    );

    const call = processRunner.execute.mock.calls[0]![0] as {
      args: string[];
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(call.args).toContain("--system-prompt");
    expect(call.args).toContain("You are a careful planner.");
    expect(call.context).toEqual({ runId: "run-123", stage: "planner", runtime: "claude-code" });
  });

  it("omits the context field when no runId is provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      logger as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toBeUndefined();
  });

  it("scans an NDJSON stream from the end and unwraps the last line with type 'result'", async () => {
    // Multi-line NDJSON stdout: the overall blob is NOT valid single JSON, so
    // unwrapClaudeEnvelope must fall back to scanning lines. The matching
    // line is placed first (lowest index) so the backward scan has to skip
    // a blank line, an unparseable line, and a parseable-but-wrong-type line
    // before it finds the match.
    const resultLine = JSON.stringify({
      type: "result",
      result: validStructuredOutput,
      is_error: false,
    });
    const ndjson = [
      resultLine,
      "",
      "not valid json line",
      JSON.stringify({ type: "progress", step: 1 }),
      JSON.stringify({ type: "init", sessionId: "abc" }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      logger as never,
    );

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(out.success).toBe(true);
    expect(out.parsed.payload.value).toBe("ok");
    expect(out.raw).toBe(validStructuredOutput);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("falls back to the raw stdout when neither single-JSON nor NDJSON parsing finds a result line", async () => {
    const garbage = "not json at all\nalso not json\nstill no structured output here";

    const processRunner = makeMockProcessRunner({
      stdout: garbage,
      stderr: "",
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      logger as never,
    );

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logFields] = logger.error.mock.calls[0]!;
    // outputSnippet is derived from the unwrapped text, which (having found no
    // match) falls back to the raw stdout unchanged.
    expect(logFields.outputSnippet).toContain("still no structured output here");
  });
});

describe("ClaudeCodeRunner.chatRun() — arg filtering and error surfacing", () => {
  const successEnvelope = JSON.stringify({
    type: "result",
    is_error: false,
    result: "The current plan looks good.",
  });

  const errorEnvelope = JSON.stringify({
    type: "result",
    is_error: true,
    result: "API Error: Stream idle timeout",
  });

  it("never passes --dangerously-skip-permissions to the subprocess even if present in baseArgs", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successEnvelope,
      stderr: "",
      exitCode: 0,
      durationMs: 100,
      timedOut: false,
    });
    const logger = makeMockLogger();

    // Intentionally inject the dangerous flag into baseArgs to verify it is stripped.
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      ["--output-format", "json", "--dangerously-skip-permissions"],
      "claude-opus-4-8",
      logger as never,
    );

    await runner.chatRun(
      { prompt: "What's the plan?", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    expect(processRunner.execute).toHaveBeenCalledOnce();
    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--dangerously-skip-permissions");
    // Other args are preserved
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
  });

  it("strips --dangerously-skip-permissions even when it appears multiple times in baseArgs", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successEnvelope,
      stderr: "",
      exitCode: 0,
      durationMs: 50,
      timedOut: false,
    });
    const logger = makeMockLogger();

    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      ["--dangerously-skip-permissions", "--verbose", "--dangerously-skip-permissions"],
      "claude-opus-4-8",
      logger as never,
    );

    await runner.chatRun(
      { prompt: "Hello", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args.filter((a) => a === "--dangerously-skip-permissions")).toHaveLength(0);
  });

  it("returns { text, durationMs } on success", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successEnvelope,
      stderr: "",
      exitCode: 0,
      durationMs: 123,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      logger as never,
    );

    const result = await runner.chatRun(
      { prompt: "Hello", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    expect(result.text).toBe("The current plan looks good.");
    expect(result.durationMs).toBe(123);
  });

  it("passes a runId context through to the process runner when provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successEnvelope,
      stderr: "",
      exitCode: 0,
      durationMs: 50,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      logger as never,
    );

    await runner.chatRun(
      { prompt: "Hello", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-chat-1" },
      "chat",
    );

    const call = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(call.context).toEqual({ runId: "run-chat-1", stage: "chat", runtime: "claude-code" });
  });

  it("throws and logs when CLI exits non-zero", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "Something went wrong", is_error: false }),
      stderr: "signal: killed",
      exitCode: 1,
      durationMs: 50,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      logger as never,
    );

    await expect(
      runner.chatRun({ prompt: "Hello", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat"),
    ).rejects.toThrow(/Claude CLI exited with code 1/);

    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("throws and logs when CLI reports is_error: true in the envelope", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: errorEnvelope,
      stderr: "",
      exitCode: 0,
      durationMs: 200,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      logger as never,
    );

    await expect(
      runner.chatRun({ prompt: "Hello", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat"),
    ).rejects.toThrow(/Claude CLI API error/);

    expect(logger.error).toHaveBeenCalledOnce();
    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields).toMatchObject({ upstreamApiError: true });
  });
});
