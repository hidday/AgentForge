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

describe("ClaudeCodeRunner.buildArgs() systemPrompt handling", () => {
  it("appends --system-prompt when input.systemPrompt is set (run())", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({
        type: "result",
        result: 'BEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\nEND_STRUCTURED_OUTPUT',
      }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      ["--print"],
      "claude-opus-4-8",
      logger as never,
    );

    await runner.run(
      {
        prompt: "hi",
        systemPrompt: "You are a helpful planner.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toContain("--system-prompt");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("You are a helpful planner.");
  });

  it("does not append --system-prompt when input.systemPrompt is absent", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({
        type: "result",
        result: 'BEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\nEND_STRUCTURED_OUTPUT',
      }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new ClaudeCodeRunner(
      processRunner as never,
      "claude",
      ["--print"],
      "claude-opus-4-8",
      logger as never,
    );

    await runner.run(
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).not.toContain("--system-prompt");
  });
});

describe("ClaudeCodeRunner process context wiring", () => {
  it("run() passes context=undefined to processRunner.execute when input.runId is absent", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({
        type: "result",
        result: 'BEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\nEND_STRUCTURED_OUTPUT',
      }),
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
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toBeUndefined();
  });

  it("chatRun() passes context=undefined to processRunner.execute when input.runId is absent", async () => {
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
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toBeUndefined();
  });

  it("run() builds a { runId, stage, runtime } context when input.runId is present", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({
        type: "result",
        result: 'BEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\nEND_STRUCTURED_OUTPUT',
      }),
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
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-42" },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-42", stage: "planner", runtime: "claude-code" });
  });

  it("chatRun() builds a { runId, stage, runtime } context when input.runId is present", async () => {
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
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-43" },
      "chat",
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-43", stage: "chat", runtime: "claude-code" });
  });
});

describe("ClaudeCodeRunner unwrapClaudeEnvelope() NDJSON fallback path", () => {
  it("scans NDJSON lines from the end and uses the last result line, skipping blank/invalid lines", async () => {
    const ndjson = [
      "",
      '{"type":"log","message":"starting up"}',
      "not json at all",
      '{"type":"result","result":"first result (should be ignored, not last)"}',
      "",
      '{"type":"result","result":"final NDJSON answer","is_error":false}',
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

    const result = await runner.chatRun(
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    expect(result.text).toBe("final NDJSON answer");
  });

  it("surfaces is_error true from an NDJSON result line", async () => {
    const ndjson = [
      '{"type":"progress"}',
      '{"type":"result","result":"upstream failed","is_error":true}',
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

    await expect(
      runner.chatRun({ prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 }, "chat"),
    ).rejects.toThrow(/Claude CLI API error/);

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.upstreamApiError).toBe(true);
  });

  it("falls back to raw stdout with isApiError=false when no line parses as a result envelope", async () => {
    const raw = "just plain text\nwith multiple lines\nnone of which are JSON";

    const processRunner = makeMockProcessRunner({
      stdout: raw,
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
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    expect(result.text).toBe(raw);
  });

  it("treats an object line with type 'result' but non-string result as non-matching (keeps scanning)", async () => {
    const ndjson = [
      '{"type":"result","result":"the real answer"}',
      '{"type":"result","result":123}',
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
      { prompt: "hi", workingDirectory: "/tmp", timeoutMs: 1000 },
      "chat",
    );

    // Scanning happens from the last line backwards: the trailing line has a
    // non-string `result` and is skipped, so the scan continues to the earlier
    // line whose string result is the match.
    expect(result.text).toBe("the real answer");
  });
});
