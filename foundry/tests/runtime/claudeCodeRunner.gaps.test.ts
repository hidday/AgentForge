import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

const echoSchema = z.object({
  success: z.boolean(),
  stage: z.literal("planner"),
  payload: z.object({ value: z.string() }),
});

const validStructuredOutput = `Preamble.

BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT
`;

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

describe("ClaudeCodeRunner.buildArgs — systemPrompt", () => {
  it("passes --system-prompt when input.systemPrompt is set", async () => {
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
      {
        prompt: "Hello",
        systemPrompt: "You are a helpful assistant.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "chat",
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toContain("--system-prompt");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("You are a helpful assistant.");
  });

  it("passes a runId-scoped context to the process runner when input.runId is set", async () => {
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-1" },
      "planner",
    );

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toEqual({ runId: "run-1", stage: "planner", runtime: "claude-code" });
  });

  it("run() also passes a runId-scoped context to the process runner when input.runId is set", async () => {
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-2" },
      "planner",
      echoSchema,
    );

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toEqual({ runId: "run-2", stage: "planner", runtime: "claude-code" });
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope — NDJSON stream format", () => {
  it("scans an NDJSON stream from the end and extracts the last 'result' line", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "..." }] } }),
      JSON.stringify({ type: "result", result: "Final answer from stream." }),
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

    expect(result.text).toBe("Final answer from stream.");
  });

  it("skips blank lines and lines that fail to parse while scanning backward for the result line", async () => {
    // The scan walks from the LAST line backward, so the lines the skip/catch
    // branches need to exercise must come AFTER (higher index than) the
    // matching result line, or the scan returns before ever reaching them.
    const ndjson = [
      JSON.stringify({ type: "result", result: "The real final answer." }),
      "",
      "not valid json at all {{{",
      JSON.stringify({ type: "assistant" }),
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

    expect(result.text).toBe("The real final answer.");
  });

  it("falls back to the raw stdout when nothing in the stream parses as a result envelope", async () => {
    const rawChattyOutput = "Just some plain text with no JSON envelope at all.";

    const processRunner = makeMockProcessRunner({
      stdout: rawChattyOutput,
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

    expect(result.text).toBe(rawChattyOutput);
  });
});
