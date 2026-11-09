import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
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

const validStructuredOutput = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("CursorRunner — buildStdinPayload() systemPrompt handling", () => {
  it("prepends the system prompt, separated by '---', when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      {
        prompt: "the task",
        systemPrompt: "You are the planner.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are the planner.\n\n---\n\nthe task");
  });

  it("uses the raw prompt as stdin when no systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "the task", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("the task");
  });
});

describe("CursorRunner — buildArgs()", () => {
  it("includes --model and --workspace flags built from input/model", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      ["--base-flag"],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/work/dir", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toEqual([
      "--base-flag",
      "--model",
      "claude-4.6-sonnet",
      "--workspace",
      "/work/dir",
    ]);
  });
});

describe("CursorRunner — long-output truncation in error logging", () => {
  it("truncates a long outputSnippet and stderr to a tail with an ellipsis prefix", async () => {
    const longResult = "R".repeat(900) + "[TAIL_MARKER]";
    const longStderr = "S".repeat(700) + "[STDERR_TAIL]";
    const envelope = JSON.stringify({ type: "result", result: longResult });

    const processRunner = makeMockProcessRunner({
      stdout: envelope,
      stderr: longStderr,
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      [],
      "claude-4.6-sonnet",
      logger as never,
    );

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[TAIL_MARKER]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
    expect(logFields.stderr.startsWith("…")).toBe(true);
    expect(logFields.stderr).toContain("[STDERR_TAIL]");
    expect(logFields.stderr.length).toBeLessThanOrEqual(501);
  });
});
