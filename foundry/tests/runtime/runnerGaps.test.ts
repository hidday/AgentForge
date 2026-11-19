import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import { CodexRunner } from "../../src/runtime/codexRunner.js";
import { CursorRunner } from "../../src/runtime/cursorRunner.js";
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

describe("ClaudeCodeRunner — remaining branches", () => {
  it("includes --system-prompt in the built args when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "hi" }),
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

    await runner.chatRun(
      {
        prompt: "do it",
        systemPrompt: "You are a helpful assistant",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "chat",
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toContain("--system-prompt");
    expect(args).toContain("You are a helpful assistant");
  });

  it("extracts the result text from an NDJSON stream, scanning from the last line", async () => {
    const ndjsonResult = {
      type: "result",
      result: "BEGIN_STRUCTURED_OUTPUT\n" +
        JSON.stringify({ success: true, stage: "planner", payload: { value: "ndjson-ok" } }) +
        "\nEND_STRUCTURED_OUTPUT",
    };
    const stdout = [
      '{"type":"system","subtype":"init"}',
      "not valid json, should be skipped while scanning backward",
      JSON.stringify(ndjsonResult),
      "",
    ].join("\n");

    const processRunner = makeMockProcessRunner({
      stdout,
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

    expect(out.parsed.payload.value).toBe("ndjson-ok");
  });

  it("falls back to the raw output when neither single-JSON nor NDJSON result lines are found", async () => {
    const stdout = "just plain non-JSON chatter\nwith multiple lines\nand no envelope at all";
    const processRunner = makeMockProcessRunner({
      stdout,
      stderr: "",
      exitCode: 1,
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

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();
  });
});

describe("CodexRunner — remaining branches", () => {
  it("prepends --model directly (no exec-subcommand insertion) when baseArgs[0] is not 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok" }),
      stderr: "",
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["--some-flag"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toEqual(["--model", "gpt-5.6-sol", "--some-flag"]);
  });

  it("prepends the system prompt to the stdin payload ahead of the task prompt", async () => {
    const structuredStdout = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\nEND_STRUCTURED_OUTPUT`;
    const processRunner = makeMockProcessRunner({
      stdout: structuredStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run(
      {
        prompt: "do the task",
        systemPrompt: "system rules",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("system rules\n\n---\n\ndo the task");
  });
});

describe("CursorRunner — remaining branches", () => {
  it("prepends the system prompt to the stdin payload ahead of the task prompt", async () => {
    const structuredBlock = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\nEND_STRUCTURED_OUTPUT`;
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: structuredBlock }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "agent",
      [],
      "claude-4.7-opus",
      makeMockLogger() as never,
    );

    await runner.run(
      {
        prompt: "do the task",
        systemPrompt: "system rules",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("system rules\n\n---\n\ndo the task");
  });

  it("truncates a long stderr/outputSnippet tail with an ellipsis prefix when logging a non-zero exit", async () => {
    const longStdout = "X".repeat(900) + "[TAIL_MARKER]";
    const longStderr = "E".repeat(700) + "[STDERR_TAIL]";
    const processRunner = makeMockProcessRunner({
      stdout: longStdout,
      stderr: longStderr,
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "agent",
      [],
      "claude-4.7-opus",
      logger as never,
    );

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[TAIL_MARKER]");
    expect(logFields.stderr.startsWith("…")).toBe(true);
    expect(logFields.stderr).toContain("[STDERR_TAIL]");
  });
});
