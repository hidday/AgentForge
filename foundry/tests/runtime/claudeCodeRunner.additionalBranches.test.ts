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

const validStructuredOutput = `preamble
BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT
`;

describe("ClaudeCodeRunner.buildArgs — systemPrompt branch", () => {
  it("includes --system-prompt in the spawned args when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "model-x", logger as never);

    await runner.run(
      {
        prompt: "do work",
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

  it("omits --system-prompt entirely when input.systemPrompt is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "model-x", logger as never);

    await runner.run({ prompt: "do work", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner — process context (runId) ternary", () => {
  it("run(): passes a context object to the process runner when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredOutput }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "model-x", logger as never);

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-42" },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toEqual({ runId: "run-42", stage: "planner", runtime: "claude-code" });
  });

  it("chatRun(): passes a context object to the process runner when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "answer", is_error: false }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "model-x", logger as never);

    await runner.chatRun(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-77" },
      "chat",
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toEqual({ runId: "run-77", stage: "chat", runtime: "claude-code" });
  });
});

describe("ClaudeCodeRunner.unwrapClaudeEnvelope — NDJSON fallback scanning", () => {
  it("scans NDJSON lines from the end, skipping blank and malformed lines, to find the result line", async () => {
    const ndjson = [
      '{"type":"system","subtype":"init"}',
      "",
      "not json at all {{{",
      '{"type":"assistant","message":"thinking..."}',
      '{"type":"result","result":"final answer text","is_error":false}',
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "model-x", logger as never);

    const result = await runner.chatRun(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    expect(result.text).toBe("final answer text");
  });

  it("falls back to the raw output when neither single-JSON nor NDJSON contains a result line", async () => {
    const raw = "just some plain text\nwith multiple lines\nand no JSON anywhere";

    const processRunner = makeMockProcessRunner({
      stdout: raw,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "model-x", logger as never);

    const result = await runner.chatRun(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    expect(result.text).toBe(raw);
  });

  it("treats an NDJSON line whose type is not 'result' as non-matching and keeps scanning", async () => {
    const ndjson = [
      '{"type":"result_but_not_quite":"nope"}',
      '{"type":"other","foo":"bar"}',
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout: ndjson,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(processRunner as never, "claude", [], "model-x", logger as never);

    const result = await runner.chatRun(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    // No line matched type "result" with a string result -- falls back to raw.
    expect(result.text).toBe(ndjson);
  });
});
