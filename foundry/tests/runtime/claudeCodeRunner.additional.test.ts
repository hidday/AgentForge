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

const validStructuredOutput = `${"BEGIN_STRUCTURED_OUTPUT"}
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("ClaudeCodeRunner — args and envelope-parsing branches", () => {
  it("passes --system-prompt when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
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

  it("does not pass --system-prompt when input.systemPrompt is unset", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });

  it("falls back to scanning NDJSON stream lines for the last {type:'result'} entry", async () => {
    const ndjson = [
      "not json at all",
      JSON.stringify({ type: "system", subtype: "init" }),
      "", // blank line, must be skipped
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
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      [],
      "claude-opus-4-8",
      makeMockLogger() as never,
    );

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(out.parsed.payload.value).toBe("ok");
  });

  it("skips NDJSON lines that fail to parse as JSON while scanning from the end", async () => {
    const ndjson = [
      JSON.stringify({ type: "result", result: validStructuredOutput }),
      "{ this is not valid json at all",
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
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

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    // The trailing malformed line is skipped; the earlier valid "result" line
    // (scanned from the end backwards, so the malformed line is checked
    // first and discarded) is still found.
    expect(out.parsed.payload.value).toBe("ok");
  });

  it("falls back to the raw output text when neither single-JSON nor NDJSON result parsing succeeds", async () => {
    const raw = `plain text chatter\n${validStructuredOutput}`;
    const processRunner = makeMockProcessRunner({
      stdout: raw,
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

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    // raw wasn't a JSON envelope of any kind, so unwrapClaudeEnvelope returns
    // the raw text unchanged, and structured-output extraction still finds
    // the BEGIN/END block within it.
    expect(out.raw).toBe(raw);
    expect(out.parsed.payload.value).toBe("ok");
  });
});
