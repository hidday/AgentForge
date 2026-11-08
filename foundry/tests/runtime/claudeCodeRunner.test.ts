import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

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

describe("ClaudeCodeRunner.buildArgs() — system prompt flag", () => {
  it("passes --system-prompt when a system prompt is provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      makeMockLogger() as never,
    );

    await runner.run(
      {
        prompt: "do it",
        systemPrompt: "Be concise.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toContain("--system-prompt");
    expect(args).toContain("Be concise.");
  });

  it("omits --system-prompt when no system prompt is provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope() — NDJSON stream format", () => {
  it("scans an NDJSON stream from the end and extracts the last {type:'result'} line", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: "thinking..." }),
      JSON.stringify({
        type: "result",
        result: `${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\n${STRUCTURED_OUTPUT_END}`,
        is_error: false,
      }),
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

    expect(out.parsed.payload.value).toBe("ok");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("skips blank lines while scanning the NDJSON stream from the end", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "result",
        result: `${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\n${STRUCTURED_OUTPUT_END}`,
        is_error: false,
      }),
      "", // trailing blank line, e.g. from a final newline in the raw stdout
      "   ", // whitespace-only line
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

    expect(out.parsed.payload.value).toBe("ok");
  });

  it("treats is_error:true on the last NDJSON result line as an upstream API error", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", result: "API Error: overloaded", is_error: true }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
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

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields).toMatchObject({ upstreamApiError: true });
  });

  it("skips blank lines and lines that are not valid JSON while scanning for the result line", async () => {
    const ndjson = [
      "",
      "not json at all {{{",
      "   ",
      JSON.stringify({
        type: "result",
        result: `${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\n${STRUCTURED_OUTPUT_END}`,
      }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      makeMockLogger() as never,
    );

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );
    expect(out.parsed.payload.value).toBe("ok");
  });

  it("falls back to the raw output verbatim (isApiError:false) when neither single-JSON nor NDJSON parsing finds a result", async () => {
    const raw = `plain text output\n${STRUCTURED_OUTPUT_BEGIN}\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\n${STRUCTURED_OUTPUT_END}`;

    const processRunner = makeMockProcessRunner({
      stdout: raw,
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

    expect(out.raw).toBe(raw);
    expect(out.parsed.payload.value).toBe("ok");
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("ClaudeCodeRunner — process context propagation", () => {
  it("run() passes a context with runId/stage/runtime when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-123" },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { runId: "run-123", stage: "planner", runtime: "claude-code" },
      }),
    );
  });

  it("run() passes context: undefined when input.runId is absent", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      makeMockLogger() as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ context: undefined }),
    );
  });

  it("chatRun() passes a context with runId/stage/runtime when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "A plain chat answer." }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      makeMockLogger() as never,
    );

    await runner.chatRun(
      { prompt: "Hello", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-456" },
      "chat",
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { runId: "run-456", stage: "chat", runtime: "claude-code" },
      }),
    );
  });
});
