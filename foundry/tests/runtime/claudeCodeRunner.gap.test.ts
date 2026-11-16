import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Targets the small remaining gaps in claudeCodeRunner.ts that
// claudeCodeRunner.test.ts does not exercise:
//   - buildArgs() passing --system-prompt when input.systemPrompt is set
//   - unwrapClaudeEnvelope()'s NDJSON fallback path (lines ~180-197), which is
//     only reached when the whole stdout string fails to parse as a single
//     JSON envelope.

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

const structuredStdoutEnvelope = JSON.stringify({
  type: "result",
  result: `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`,
});

describe("ClaudeCodeRunner.buildArgs — systemPrompt flag", () => {
  it("passes --system-prompt when input.systemPrompt is set (run())", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredStdoutEnvelope,
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
    expect(args).toContain("--system-prompt");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("You are a careful planner.");
  });

  it("omits --system-prompt entirely when input.systemPrompt is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredStdoutEnvelope,
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

describe("ClaudeCodeRunner — process context passed to the process runner when runId is set", () => {
  it("run() builds a { runId, stage, runtime } context when input.runId is present", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredStdoutEnvelope,
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

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-123", stage: "planner", runtime: "claude-code" });
  });

  it("chatRun() builds a { runId, stage, runtime } context when input.runId is present", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "hi there" }),
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-456" },
      "chat",
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-456", stage: "chat", runtime: "claude-code" });
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope — NDJSON fallback", () => {
  it("extracts the result from an NDJSON stream's trailing result line, skipping blank lines", async () => {
    const stdout = [
      JSON.stringify({ type: "thinking", text: "..." }),
      "",
      JSON.stringify({ type: "result", result: "hello from ndjson", is_error: false }),
      "",
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout,
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

    expect(result.text).toBe("hello from ndjson");
  });

  it("skips malformed JSON lines and still finds an earlier valid result line (catch-and-continue)", async () => {
    const stdout = [
      JSON.stringify({ type: "result", result: "first and only valid result" }),
      "this line is not valid JSON at all {{{",
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout,
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

    expect(result.text).toBe("first and only valid result");
  });

  it("falls back to the raw output when nothing parses as single JSON or an NDJSON result line", async () => {
    const stdout = "plain text crash output\nwith no JSON anywhere\nin it";

    const processRunner = makeMockProcessRunner({
      stdout,
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

    expect(result.text).toBe(stdout);
  });

  it("does not treat an NDJSON line with type result but a non-string result field as the answer", async () => {
    const stdout = [
      JSON.stringify({ type: "result", result: 12345 }),
      JSON.stringify({ type: "result", result: "the real text answer" }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout,
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

    // Scans from the end: the last line has a valid string result, so that's
    // the one that wins even though an earlier line also had type "result".
    expect(result.text).toBe("the real text answer");
  });

  it("run() parses structured output recovered via the NDJSON fallback path", async () => {
    const validStructuredOutput = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ndjson-ok"}}
END_STRUCTURED_OUTPUT`;

    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", result: validStructuredOutput, is_error: false }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout,
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

    expect(out.parsed.payload.value).toBe("ndjson-ok");
    expect(logger.error).not.toHaveBeenCalled();
  });
});
