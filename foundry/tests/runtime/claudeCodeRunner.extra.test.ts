import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Closes remaining coverage gaps in claudeCodeRunner.ts:
//   - buildArgs(): the --system-prompt branch (lines ~141-143)
//   - unwrapClaudeEnvelope(): the NDJSON stream-format fallback path
//     (lines ~180-197), including its own inner try/catch

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

const validStructuredOutput = `Some preamble text.

BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT
`;

describe("ClaudeCodeRunner.buildArgs() — systemPrompt", () => {
  it("includes --system-prompt in the spawned args when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok" }),
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

    await runner.chatRun(
      {
        prompt: "hello",
        systemPrompt: "You are a helpful planner.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "chat",
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    const idx = args.indexOf("--system-prompt");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("You are a helpful planner.");
  });

  it("omits --system-prompt entirely when input.systemPrompt is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok" }),
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

    await runner.chatRun({ prompt: "hello", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat");

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner — process context wiring", () => {
  it("passes a context object (runId/stage/runtime) to processRunner.execute when input.runId is set, in both run() and chatRun()", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok" }),
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-123" },
      "chat",
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { runId: "run-123", stage: "chat", runtime: "claude-code" },
      }),
    );
  });

  it("omits context entirely when input.runId is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok" }),
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

    await runner.chatRun({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat");

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ context: undefined }),
    );
  });

  it("passes a context object via run() as well when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-456" },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { runId: "run-456", stage: "planner", runtime: "claude-code" },
      }),
    );
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope() — NDJSON stream format", () => {
  it("scans an NDJSON stream from the end and extracts the last type:result line", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: "thinking..." }),
      JSON.stringify({ type: "result", result: "final answer text", is_error: false }),
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

    const result = await runner.chatRun(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    expect(result.text).toBe("final answer text");
  });

  it("skips blank lines and lines that are not valid JSON while scanning NDJSON", async () => {
    const ndjson = [
      '{"type":"system"}',
      "",
      "not json at all {{{",
      "   ",
      '{"type":"result","result":"recovered text","is_error":true}',
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
      runner.chatRun({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat"),
    ).rejects.toThrow(/Claude CLI API error/);

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.upstreamApiError).toBe(true);
    expect(logFields.outputSnippet).toContain("recovered text");
  });

  it("falls back to raw output with isApiError=false when nothing parses as JSON at all (run())", async () => {
    const raw = "complete garbage, not json, not ndjson\nstill garbage";

    const processRunner = makeMockProcessRunner({
      stdout: raw,
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
      runner.run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow();

    const [logFields, logMessage] = logger.error.mock.calls[0]!;
    expect(logMessage).toBe(
      "Claude Code CLI returned non-zero exit code with no structured output",
    );
    expect(logFields.upstreamApiError).toBeUndefined();
    expect(logFields.outputSnippet).toContain("still garbage");
  });

  it("does not treat a single-line JSON object without a `result` string as the envelope (falls through to NDJSON scan)", async () => {
    // A single valid JSON object whose `result` field is missing/non-string
    // must not short-circuit the fast path; it should fall through to the
    // NDJSON line scan, which also finds nothing, and ultimately return raw.
    const raw = JSON.stringify({ type: "result", result: 12345 });

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

    const result = await runner.chatRun(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    expect(result.text).toBe(raw);
  });
});
