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

const validStructuredBlock = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("CursorRunner.buildStdinPayload — systemPrompt prepending", () => {
  it("prepends the system prompt, separated by a '---' delimiter, when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredBlock }),
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
      {
        prompt: "Fix the bug.",
        systemPrompt: "You are the cursor executor agent.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "executor",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are the cursor executor agent.\n\n---\n\nFix the bug.");
  });

  it("uses the prompt alone, with no delimiter, when input.systemPrompt is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredBlock }),
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
      { prompt: "Fix the bug.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("Fix the bug.");
    expect(stdinData).not.toContain("---");
  });
});

describe("CursorRunner.buildArgs — model and workspace flags", () => {
  it("appends --model and --workspace to the configured baseArgs", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validStructuredBlock }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor",
      ["--non-interactive"],
      "claude-4.6-sonnet",
      logger as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/work/repo", timeoutMs: 1000, model: "claude-4.6-opus" },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--non-interactive", "--model", "claude-4.6-opus", "--workspace", "/work/repo"],
      }),
    );
  });
});

describe("CursorRunner.run() — tailSnippet truncation on long output", () => {
  it("truncates a long outputSnippet and stderr to their tail with an ellipsis prefix", async () => {
    const longResult = "Y".repeat(900) + "[RESULT_TAIL_MARKER]";
    const longStderr = "E".repeat(700) + "[STDERR_TAIL_MARKER]";
    const envelope = JSON.stringify({ type: "result", result: longResult });

    const processRunner = makeMockProcessRunner({
      stdout: envelope,
      stderr: longStderr,
      exitCode: 1,
      durationMs: 100,
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
      runner.run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[RESULT_TAIL_MARKER]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
    expect(logFields.stderr.startsWith("…")).toBe(true);
    expect(logFields.stderr).toContain("[STDERR_TAIL_MARKER]");
    expect(logFields.stderr.length).toBeLessThanOrEqual(501);
  });

  it("does not truncate a short outputSnippet or stderr (no ellipsis prefix)", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "short failure message" }),
      stderr: "short stderr",
      exitCode: 1,
      durationMs: 50,
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
      runner.run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet).toBe("short failure message");
    expect(logFields.stderr).toBe("short stderr");
  });
});
