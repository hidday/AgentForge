import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CursorRunner } from "../../src/runtime/cursorRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Targets the small remaining gaps in cursorRunner.ts that cursorRunner.test.ts
// does not exercise:
//   - buildStdinPayload() prepending systemPrompt to the prompt
//   - tailSnippet()'s truncation branch (stderr/outputSnippet longer than 500
//     chars), which every existing test avoids by using short strings.

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

describe("CursorRunner.buildStdinPayload — systemPrompt prefix", () => {
  it("prepends the system prompt, separated by '---', ahead of the user prompt on stdin", async () => {
    const validBlock = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validBlock }),
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

    const out = await runner.run(
      {
        prompt: "Implement the feature.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
        systemPrompt: "You are the executor agent.",
      },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        stdinData: "You are the executor agent.\n\n---\n\nImplement the feature.",
      }),
    );
    expect(out.parsed.payload.value).toBe("ok");
  });

  it("uses the raw prompt as stdin when no systemPrompt is given", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok" }),
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
      { prompt: "Just the prompt.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      z.unknown(),
    ).catch(() => {
      // Not a structured-output block; we only care about the stdin passed
      // to the process runner for this assertion.
    });

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "Just the prompt." }),
    );
  });
});

describe("CursorRunner tailSnippet — truncation branch", () => {
  it("truncates a long stderr and outputSnippet to a tail with an ellipsis prefix", async () => {
    const longResult = "R".repeat(900) + "[RESULT_TAIL]";
    const longStderr = "E".repeat(700) + "[STDERR_TAIL]";
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
});

describe("CursorRunner — process context passed to the process runner when runId is set", () => {
  it("builds a { runId, stage, runtime: 'cursor' } context when input.runId is present", async () => {
    const validBlock = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validBlock }),
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
