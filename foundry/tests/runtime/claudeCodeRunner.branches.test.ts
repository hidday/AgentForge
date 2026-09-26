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

const validStructuredOutput = `Some preamble text.

BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT
`;

describe("ClaudeCodeRunner — buildArgs / context branches", () => {
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
      { prompt: "x", systemPrompt: "You are a planner.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toContain("--system-prompt");
    expect(args).toContain("You are a planner.");
  });

  it("does not pass --system-prompt when input.systemPrompt is absent", async () => {
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

  it("passes a context object with runId/stage/runtime when input.runId is set (run())", async () => {
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-42" },
      "planner",
      echoSchema,
    );

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toEqual({ runId: "run-42", stage: "planner", runtime: "claude-code" });
  });

  it("passes a context object with runId/stage/runtime when input.runId is set (chatRun())", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", is_error: false, result: "ok" }),
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
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-99" },
      "chat",
    );

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toEqual({ runId: "run-99", stage: "chat", runtime: "claude-code" });
  });
});

describe("ClaudeCodeRunner — NDJSON envelope unwrapping", () => {
  it("extracts the result text from an NDJSON stream, scanning from the last line", async () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: "thinking..." }),
      JSON.stringify({ type: "result", result: validStructuredOutput, is_error: false }),
    ];
    const processRunner = makeMockProcessRunner({
      stdout: lines.join("\n"),
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

    expect(out.success).toBe(true);
    expect(out.parsed.payload.value).toBe("ok");
  });

  it("falls back to the raw stdout text when neither single-JSON nor NDJSON parsing finds a result", async () => {
    const rawOutput = "this is not json\nnor is this second line";
    const processRunner = makeMockProcessRunner({
      stdout: rawOutput,
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
    expect(logFields.upstreamApiError).toBeUndefined();
    expect(logFields.outputSnippet).toContain("nor is this second line");
  });
});
