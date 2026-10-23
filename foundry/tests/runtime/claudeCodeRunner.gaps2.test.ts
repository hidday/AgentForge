import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Covers two branches not exercised by claudeCodeRunner.test.ts or
// claudeCodeRunner.gaps.test.ts:
//   - chatRun()'s context-building ternary when input.runId IS set (the
//     existing gaps test for this exact ternary only covers it in run(),
//     and every chatRun() test omits runId)
//   - unwrapClaudeEnvelope()'s NDJSON blank-line-skip branch, which requires
//     the WHOLE raw string to fail a single JSON.parse first (otherwise the
//     fast path returns before the NDJSON loop is ever reached, even if the
//     raw text has trailing blank lines)

function makeMockProcessRunner(result: ProcessResult) {
  return { execute: vi.fn().mockResolvedValue(result) };
}

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe("ClaudeCodeRunner.chatRun — context wiring with runId set", () => {
  it("passes a context object (runId/stage/runtime) to processRunner.execute when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok" }),
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
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-chat-1" },
      "chat",
    );

    const call = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(call.context).toEqual({ runId: "run-chat-1", stage: "chat", runtime: "claude-code" });
  });
});

describe("ClaudeCodeRunner — unwrapClaudeEnvelope NDJSON blank-line skip", () => {
  it("skips a trailing blank line while scanning NDJSON lines from the end, when the whole raw text is not itself valid single JSON", async () => {
    // Two JSON objects back-to-back make JSON.parse(raw) fail (trailing
    // non-whitespace content after the first value), so this genuinely falls
    // through to the NDJSON line scan -- unlike a single result object
    // followed only by whitespace, which JSON.parse happily accepts whole.
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", result: "Answer text", is_error: false }),
      "",
      "   ",
    ].join("\n");

    expect(() => JSON.parse(ndjson)).toThrow();

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      makeMockLogger() as never,
    );

    const result = await runner.chatRun(
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    expect(result.text).toBe("Answer text");
  });
});
