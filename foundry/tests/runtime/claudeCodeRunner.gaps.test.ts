import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

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

describe("ClaudeCodeRunner.buildArgs() — systemPrompt", () => {
  it("passes --system-prompt to the CLI when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ack", is_error: false }),
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
        prompt: "What's next?",
        systemPrompt: "You are a terse assistant.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "chat",
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    const spIdx = args.indexOf("--system-prompt");
    expect(spIdx).toBeGreaterThanOrEqual(0);
    expect(args[spIdx + 1]).toBe("You are a terse assistant.");
  });

  it("omits --system-prompt entirely when input.systemPrompt is unset", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ack", is_error: false }),
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

    await runner.chatRun({ prompt: "Hi", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat");

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope() — NDJSON and fallback paths", () => {
  const validBlock = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"from-ndjson"}}
END_STRUCTURED_OUTPUT`;

  it("scans NDJSON lines backward and recovers the last result line, skipping unparsable lines", async () => {
    // Line 0: an unrelated NDJSON event (not type "result").
    // Line 1: the real result line, holding the structured block.
    // Line 2: trailing garbage that is not valid JSON at all.
    const stdout = [
      JSON.stringify({ type: "init" }),
      JSON.stringify({ type: "result", result: validBlock, is_error: false }),
      "not valid json {{{",
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

    expect(out.parsed.payload.value).toBe("from-ndjson");
    expect(out.raw).toBe(validBlock);
  });

  it("falls back to the raw string with isApiError:false when output is neither a JSON envelope nor NDJSON", async () => {
    const raw = `Plain non-JSON preamble.\n${validBlock}\nTrailing note.`;

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
    expect(out.parsed.payload.value).toBe("from-ndjson");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not log upstreamApiError and reports success:false on non-zero exit when the NDJSON result line itself is unparsable structured output", async () => {
    // No BEGIN_STRUCTURED_OUTPUT marker anywhere -> extractStructuredBlock should throw downstream,
    // but we only assert the error-log branch distinguishes this from an API error envelope here.
    const stdout = [
      JSON.stringify({ type: "init" }),
      JSON.stringify({ type: "result", result: "chatty text, no structured block", is_error: false }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout,
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
    expect(logFields.upstreamApiError).toBeUndefined();
    expect(logFields.outputSnippet).toContain("chatty text, no structured block");
  });
});
