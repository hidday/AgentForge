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
{"success":true,"stage":"planner","payload":{"value":"ndjson-ok"}}
END_STRUCTURED_OUTPUT
`;

describe("ClaudeCodeRunner.buildArgs — systemPrompt flag", () => {
  it("passes --system-prompt when input.systemPrompt is provided (run())", async () => {
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
      { prompt: "x", systemPrompt: "You are a planner.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toContain("--system-prompt");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("You are a planner.");
  });

  it("omits --system-prompt entirely when input.systemPrompt is not provided", async () => {
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

  it("passes --system-prompt through chatRun() as well", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok", is_error: false }),
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
      { prompt: "Hi", systemPrompt: "Be terse.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toContain("--system-prompt");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("Be terse.");
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope — NDJSON stream fallback", () => {
  it("scans backward past blank lines and unparseable lines to find the last {type:result} line", async () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", is_error: false, result: validStructuredOutput }),
      "not valid json at all",
      "",
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout,
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

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(out.parsed.payload.value).toBe("ndjson-ok");
    expect(out.success).toBe(true);
  });

  it("surfaces isApiError from the matched NDJSON result line", async () => {
    const stdout = [
      JSON.stringify({ type: "system" }),
      JSON.stringify({ type: "result", is_error: true, result: "API Error: overloaded" }),
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
      runner.chatRun({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat"),
    ).rejects.toThrow(/Claude CLI API error/);

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields).toMatchObject({ upstreamApiError: true });
  });

  it("falls back to the raw stdout when neither single-JSON nor any NDJSON line matches", async () => {
    const stdout = ["not json", "", "still not json", "{broken"].join("\n");

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

    // The unwrapped text (== raw stdout) has no BEGIN_STRUCTURED_OUTPUT block,
    // so parsing fails downstream — but the important thing covered here is
    // that unwrapClaudeEnvelope itself falls back to the raw string without
    // throwing, and logs it as the non-zero-exit / no-structured-output case.
    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "planner", exitCode: 1 }),
      "Claude Code CLI returned non-zero exit code with no structured output",
    );
  });
});
