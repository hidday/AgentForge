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
