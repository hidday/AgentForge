import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import { OutputParseError } from "../../src/utils/errors.js";
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

const validStructuredOutput = `preamble
BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT
`;

describe("ClaudeCodeRunner.buildArgs systemPrompt branch", () => {
  it("includes --system-prompt when input.systemPrompt is set (run)", async () => {
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

  it("omits --system-prompt when not provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "m", logger as never);

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope NDJSON scanning", () => {
  it("scans backward past blank and invalid JSON lines to find the last matching result line", async () => {
    const raw = [
      JSON.stringify({ type: "result", result: validStructuredOutput, is_error: false }),
      "",
      "not valid json {{{",
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: raw,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "m", logger as never);

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(out.parsed.payload.value).toBe("ok");
    expect(out.success).toBe(true);
  });

  it("ignores NDJSON lines whose type is not 'result' and keeps scanning", async () => {
    const raw = [
      JSON.stringify({ type: "other", result: "should not be used" }),
      JSON.stringify({ type: "result", result: validStructuredOutput, is_error: true }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: raw,
      stderr: "",
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "m", logger as never);

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    // The matched line is the LAST one (scanning from the end finds it first),
    // and its is_error:true should not block extraction of a valid structured block.
    expect(out.parsed.payload.value).toBe("ok");
  });

  it("falls back to raw output when no line parses as a result envelope", async () => {
    const raw = "plain log line one\nplain log line two\n{not json";

    const processRunner = makeMockProcessRunner({
      stdout: raw,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "m", logger as never);

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow(OutputParseError);
  });
});
