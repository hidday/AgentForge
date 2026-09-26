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

const successStdout = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("CursorRunner — buildStdinPayload / context branches", () => {
  it("prepends the system prompt to stdin when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successStdout,
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
      { prompt: "Do the task", systemPrompt: "You are Cursor.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const call = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(call.stdinData).toBe("You are Cursor.\n\n---\n\nDo the task");
  });

  it("uses the prompt as-is when input.systemPrompt is absent", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successStdout,
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

    await runner.run({ prompt: "Do the task", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const call = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(call.stdinData).toBe("Do the task");
  });

  it("passes a context object with runId/stage/runtime when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successStdout,
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-7" },
      "planner",
      echoSchema,
    );

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toEqual({ runId: "run-7", stage: "planner", runtime: "cursor" });
  });
});

describe("CursorRunner — tailSnippet truncation", () => {
  it("truncates a long non-JSON stdout snippet to its tail with an ellipsis prefix", async () => {
    const longOutput = "Y".repeat(600) + "[END_MARKER]";
    const processRunner = makeMockProcessRunner({
      stdout: longOutput,
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

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[END_MARKER]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
  });
});
