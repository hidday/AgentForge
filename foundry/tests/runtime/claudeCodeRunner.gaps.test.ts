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

describe("ClaudeCodeRunner — process context propagation (input.runId)", () => {
  it("run() passes a context object with runId/stage/runtime when input.runId is set", async () => {
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

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-123" },
      "planner",
      echoSchema,
    );

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toEqual({ runId: "run-123", stage: "planner", runtime: "claude-code" });
  });

  it("run() passes undefined context when input.runId is not set", async () => {
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

  it("chatRun() passes a context object with runId/stage/runtime when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "hi", is_error: false }),
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

    await runner.chatRun(
      { prompt: "Hello", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-456" },
      "chat",
    );

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toEqual({ runId: "run-456", stage: "chat", runtime: "claude-code" });
  });
});

describe("ClaudeCodeRunner.buildArgs — systemPrompt branch", () => {
  it("appends --system-prompt with the provided value when input.systemPrompt is set", async () => {
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
        workingDirectory: "/tmp",
        timeoutMs: 1000,
        systemPrompt: "You are a careful planner.",
      },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    const idx = args.indexOf("--system-prompt");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("You are a careful planner.");
  });

  it("omits --system-prompt entirely when input.systemPrompt is not set", async () => {
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

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope — NDJSON stream fallback", () => {
  it("scans NDJSON lines from the end and extracts the last type:result line", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: "thinking..." }),
      JSON.stringify({ type: "result", is_error: false, result: validStructuredOutput }),
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
    expect(out.success).toBe(true);
  });

  it("skips blank lines and lines that fail to parse as JSON while scanning backwards", async () => {
    const ndjson = [
      "",
      "not-json-at-all {{{",
      JSON.stringify({ type: "result", result: validStructuredOutput }),
      "   ", // trailing blank line after the real result
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

  it("skips well-formed JSON lines whose type is not 'result' or whose result is not a string", async () => {
    const ndjson = [
      JSON.stringify({ type: "result", result: 12345 }), // result not a string -> skip
      JSON.stringify({ type: "progress", result: "not the real payload" }), // wrong type -> skip
      JSON.stringify({ type: "result", result: validStructuredOutput }),
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

  it("falls back to treating the raw stdout as plain text when neither single-JSON nor NDJSON contains a result envelope", async () => {
    // Raw stdout is neither valid single JSON, nor NDJSON with a type:result line —
    // the whole raw string should be used verbatim as the output text.
    const rawPlainText = `not json output\n${validStructuredOutput}`;

    const processRunner = makeMockProcessRunner({
      stdout: rawPlainText,
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
    expect(out.raw).toBe(rawPlainText);
  });

  it("chatRun also falls through to plain-text fallback and does not mark it an API error", async () => {
    const rawPlainText = "The plan is fine, no JSON envelope here.";

    const processRunner = makeMockProcessRunner({
      stdout: rawPlainText,
      stderr: "",
      exitCode: 0,
      durationMs: 42,
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

    expect(result.text).toBe(rawPlainText);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
