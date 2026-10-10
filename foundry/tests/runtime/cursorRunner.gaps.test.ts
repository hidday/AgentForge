import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CursorRunner } from "../../src/runtime/cursorRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Narrowly targeted tests for the lines left uncovered by cursorRunner.test.ts:
//   - buildStdinPayload(): the systemPrompt-prefixing branch
//   - tailSnippet(): the truncation branch (string longer than `max`), never
//     hit because the existing suite only uses short strings.

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

describe("CursorRunner — context passed to processRunner.execute when runId is set", () => {
  it("includes { runId, stage, runtime } context when input.runId is set", async () => {
    const structuredResult = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\nEND_STRUCTURED_OUTPUT`;
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: structuredResult }),
      stderr: "",
      exitCode: 0,
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

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-abc" },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-abc", stage: "planner", runtime: "cursor" });
  });
});

describe("CursorRunner.buildStdinPayload — systemPrompt prefixing", () => {
  it("prepends systemPrompt + separator before the user prompt on stdin when set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "panic: ignored" }),
      stderr: "",
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

    await runner
      .run(
        {
          prompt: "the user task",
          systemPrompt: "You are Cursor.",
          workingDirectory: "/tmp",
          timeoutMs: 1000,
        },
        "planner",
        echoSchema,
      )
      .catch(() => undefined);

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are Cursor.\n\n---\n\nthe user task");
  });

  it("uses the prompt alone on stdin when systemPrompt is unset", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "panic: ignored" }),
      stderr: "",
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

    await runner
      .run({ prompt: "the user task", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema)
      .catch(() => undefined);

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("the user task");
  });
});

describe("CursorRunner — tailSnippet truncation", () => {
  it("truncates stderr and outputSnippet longer than 500 chars to a tail prefixed with an ellipsis", async () => {
    const longResult = "Y".repeat(900) + "[RESULT_TAIL]";
    const longStderr = "Z".repeat(700) + "[STDERR_TAIL]";
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
    expect(logFields.outputSnippet).toContain("[RESULT_TAIL]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
    expect(logFields.stderr.startsWith("…")).toBe(true);
    expect(logFields.stderr).toContain("[STDERR_TAIL]");
    expect(logFields.stderr.length).toBeLessThanOrEqual(501);
  });

  it("does not truncate strings at or under 500 chars (no ellipsis prefix)", async () => {
    const shortResult = "short failure message";
    const envelope = JSON.stringify({ type: "result", result: shortResult });

    const processRunner = makeMockProcessRunner({
      stdout: envelope,
      stderr: "short stderr",
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
    expect(logFields.outputSnippet).toBe(shortResult);
    expect(logFields.stderr).toBe("short stderr");
  });
});
