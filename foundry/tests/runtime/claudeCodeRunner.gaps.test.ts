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

describe("ClaudeCodeRunner.buildArgs — systemPrompt", () => {
  it("appends --system-prompt when input.systemPrompt is set", async () => {
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
      ["--output-format", "json"],
      "claude-opus-4-8",
      logger as never,
    );

    await runner.chatRun(
      {
        prompt: "hello",
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

  it("does not append --system-prompt when input.systemPrompt is absent", async () => {
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

    await runner.chatRun({ prompt: "hello", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat");

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope — NDJSON and fallback paths", () => {
  it("scans an NDJSON stream from the end and extracts the last result line", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: "thinking..." }),
      "", // blank line should be skipped
      JSON.stringify({
        type: "result",
        result:
          "BEGIN_STRUCTURED_OUTPUT\n" +
          JSON.stringify({ success: true, stage: "planner", payload: { value: "ndjson" } }) +
          "\nEND_STRUCTURED_OUTPUT",
        is_error: false,
      }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
      stderr: "",
      exitCode: 0,
      durationMs: 20,
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

    expect(out.parsed.payload.value).toBe("ndjson");
  });

  it("propagates isApiError:true found on a NDJSON result line", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", result: "API Error: boom", is_error: true }),
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
      stderr: "",
      exitCode: 1,
      durationMs: 20,
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
    expect(logFields.upstreamApiError).toBe(true);
  });

  it("falls back to raw output when stdout is neither single-JSON nor NDJSON with a result line", async () => {
    const raw = "plain text output with no JSON envelope at all";

    const processRunner = makeMockProcessRunner({
      stdout: raw,
      stderr: "some stderr",
      exitCode: 1,
      durationMs: 5,
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

    // Fallback path returns the raw text unmodified and isApiError:false, so
    // the generic (non-upstream-API-error) error branch is logged.
    const [logFields, logMessage] = logger.error.mock.calls[0]!;
    expect(logMessage).toBe(
      "Claude Code CLI returned non-zero exit code with no structured output",
    );
    expect(logFields.upstreamApiError).toBeUndefined();
    expect(logFields.outputSnippet).toContain(raw);
  });

  it("skips malformed JSON lines while scanning NDJSON and still finds the result line", async () => {
    const ndjson = [
      JSON.stringify({ type: "result", result: "recovered", is_error: false }),
      "{not valid json",
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
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
    expect(result.text).toBe("recovered");
  });
});
