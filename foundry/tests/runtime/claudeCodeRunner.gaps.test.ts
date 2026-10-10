import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Narrowly targeted tests for the lines left uncovered by the existing
// claudeCodeRunner.test.ts suite:
//   - buildArgs(): the --system-prompt branch (never exercised there)
//   - unwrapClaudeEnvelope(): the NDJSON-stream fallback path, including the
//     blank-line / malformed-line `continue` branches and the final
//     "return raw unchanged" fallback when no NDJSON line matches.

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

describe("ClaudeCodeRunner.buildArgs — systemPrompt", () => {
  it("passes --system-prompt with the given text when input.systemPrompt is set", async () => {
    const envelope = JSON.stringify({
      type: "result",
      result: `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
        success: true,
        stage: "planner",
        payload: { value: "ok" },
      })}\nEND_STRUCTURED_OUTPUT`,
    });
    const processRunner = makeMockProcessRunner({
      stdout: envelope,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      ["--print"],
      "claude-opus-4-8",
      logger as never,
    );

    await runner.run(
      {
        prompt: "do it",
        systemPrompt: "You are a careful planner.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    const idx = args.indexOf("--system-prompt");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("You are a careful planner.");
  });

  it("omits --system-prompt entirely when input.systemPrompt is unset", async () => {
    const envelope = JSON.stringify({ type: "result", result: "no structured output here" });
    const processRunner = makeMockProcessRunner({
      stdout: envelope,
      stderr: "",
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      ["--print"],
      "claude-opus-4-8",
      logger as never,
    );

    await runner
      .run({ prompt: "do it", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema)
      .catch(() => undefined);

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner — context passed to processRunner.execute when runId is set", () => {
  it("run(): includes { runId, stage, runtime } context when input.runId is set", async () => {
    const envelope = JSON.stringify({ type: "result", result: "ok text" });
    const processRunner = makeMockProcessRunner({
      stdout: envelope,
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

    await runner
      .run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-123" },
        "planner",
        echoSchema,
      )
      .catch(() => undefined);

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-123", stage: "planner", runtime: "claude-code" });
  });

  it("chatRun(): includes { runId, stage, runtime } context when input.runId is set", async () => {
    const successEnvelope = JSON.stringify({ type: "result", is_error: false, result: "fine" });
    const processRunner = makeMockProcessRunner({
      stdout: successEnvelope,
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
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-456" },
      "chat",
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-456", stage: "chat", runtime: "claude-code" });
  });
});

describe("ClaudeCodeRunner — NDJSON envelope fallback (unwrapClaudeEnvelope)", () => {
  it("scans NDJSON lines from the end, skipping blank and malformed lines, to find the result line", async () => {
    const structured = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ndjson" },
    })}\nEND_STRUCTURED_OUTPUT`;

    // Order (top to bottom): system line, then the matching result line,
    // then a blank line, then a malformed JSON line — both trailing lines
    // must be skipped by the end-to-start scan before it finds the match.
    const raw = [
      JSON.stringify({ type: "system", note: "starting" }),
      JSON.stringify({ type: "result", result: structured, is_error: false }),
      "",
      "{not valid json",
    ].join("\n");

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

    expect(out.raw).toBe(structured);
    expect(out.parsed.payload.value).toBe("ndjson");
    expect(out.success).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("falls back to returning the raw output unchanged when no NDJSON line has type 'result'", async () => {
    const raw = [
      JSON.stringify({ type: "system", note: "a" }),
      "plain text, not JSON at all",
      JSON.stringify({ type: "other", result: "not a result type" }),
    ].join("\n");

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
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logFields] = logger.error.mock.calls[0]!;
    // No unwrap happened, so the logged outputSnippet is derived from the raw text.
    expect(logFields.outputSnippet).toContain("plain text, not JSON at all");
  });
});
