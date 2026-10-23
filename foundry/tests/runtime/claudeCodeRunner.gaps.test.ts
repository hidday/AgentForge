import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// This file covers branches of ClaudeCodeRunner not exercised by the existing
// claudeCodeRunner.test.ts: the NDJSON envelope fallback, the systemPrompt
// arg, and the runId/context wiring passed through to the process runner.

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

describe("ClaudeCodeRunner — buildArgs systemPrompt and context wiring", () => {
  it("includes --system-prompt in the args when input.systemPrompt is set", async () => {
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
      ["--output-format", "json"],
      "claude-opus-4-8",
      makeMockLogger() as never,
    );

    await runner.chatRun(
      {
        prompt: "hi",
        systemPrompt: "You are a helpful assistant.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "chat",
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    const idx = args.indexOf("--system-prompt");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("You are a helpful assistant.");
  });

  it("omits --system-prompt when none is provided", async () => {
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

    await runner.chatRun({ prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat");

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });

  it("passes a context object (runId/stage/runtime) to processRunner.execute when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({
        success: true,
        stage: "planner",
        payload: { value: "ok" },
      }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    // The run() path parses structured output via BEGIN/END delimiters, so
    // use that format here instead of the chat envelope.
    processRunner.execute.mockResolvedValue({
      stdout: `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
        success: true,
        stage: "planner",
        payload: { value: "ok" },
      })}\nEND_STRUCTURED_OUTPUT`,
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

    const call = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(call.context).toEqual({ runId: "run-123", stage: "planner", runtime: "claude-code" });
  });

  it("passes context=undefined to processRunner.execute when input.runId is absent", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
        success: true,
        stage: "planner",
        payload: { value: "ok" },
      })}\nEND_STRUCTURED_OUTPUT`,
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

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toBeUndefined();
  });
});

describe("ClaudeCodeRunner — unwrapClaudeEnvelope NDJSON fallback", () => {
  it("scans NDJSON lines from the end and extracts the last result line's text", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: "thinking..." }),
      "not json at all",
      JSON.stringify({ type: "result", result: "Final NDJSON answer", is_error: false }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
      stderr: "",
      exitCode: 0,
      durationMs: 42,
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

    expect(result.text).toBe("Final NDJSON answer");
  });

  it("treats is_error:true on the NDJSON result line as an upstream API error", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", result: "API Error: timeout", is_error: true }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
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

    await expect(
      runner.chatRun({ prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat"),
    ).rejects.toThrow(/Claude CLI API error/);

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.upstreamApiError).toBe(true);
  });

  it("falls back to raw output with isApiError:false when neither single-JSON nor NDJSON result lines parse", async () => {
    const rawText = "completely unstructured plain text output";
    const processRunner = makeMockProcessRunner({
      stdout: rawText,
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

    expect(result.text).toBe(rawText);
  });

  it("skips blank lines while scanning NDJSON from the end", async () => {
    const ndjson = [
      JSON.stringify({ type: "result", result: "Answer text", is_error: false }),
      "",
      "   ",
      "",
    ].join("\n");

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
