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

const validStructuredOutput = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("ClaudeCodeRunner — buildArgs() systemPrompt handling", () => {
  it("passes --system-prompt when input.systemPrompt is set", async () => {
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
        prompt: "do the thing",
        systemPrompt: "You are a careful planner.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
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
      { prompt: "do the thing", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner — unwrapClaudeEnvelope() NDJSON stream parsing", () => {
  it("extracts the result text from the LAST NDJSON line with type 'result' when stdout is not a single JSON envelope", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: "thinking..." }),
      JSON.stringify({ type: "result", result: validStructuredOutput, is_error: false }),
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
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("skips blank lines and lines that are not valid JSON while scanning NDJSON from the end", async () => {
    const ndjson = [
      JSON.stringify({ type: "result", result: validStructuredOutput, is_error: false }),
      "",
      "not valid json at all {{{",
      "   ",
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

  it("surfaces isApiError:true from an NDJSON result line", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", result: "API Error: timeout", is_error: true }),
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
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const [logFields, logMessage] = logger.error.mock.calls[0]!;
    expect(logMessage).toBe("Claude Code CLI reported upstream API error");
    expect(logFields.upstreamApiError).toBe(true);
  });

  it("falls back to the raw output when neither a single-JSON envelope nor any NDJSON 'result' line is found", async () => {
    const raw = "completely unstructured plain text with no json anywhere";

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

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet).toContain(raw);
    expect(logFields.upstreamApiError).toBeUndefined();
  });
});
