import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CursorRunner } from "../../src/runtime/cursorRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Covers cursorRunner.ts's tailSnippet() truncation branch (output longer
// than 500 chars), which is only exercised on a non-zero exit code (the
// error-logging path). Neither cursorRunner.test.ts nor
// cursorRunner.gaps.test.ts produces output over 500 characters.

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

describe("CursorRunner — tailSnippet truncation on a long failure output", () => {
  it("truncates stderr/stdout snippets to their tail when they exceed 500 characters", async () => {
    const longStderr = "E".repeat(900);
    const longStdout = "O".repeat(900);
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
      "cursor-agent",
      [],
      "claude-4.6-sonnet",
      logger as never,
    );

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields] = logger.error.mock.calls[0]!;
    // tailSnippet keeps only the last 500 chars, prefixed with an ellipsis.
    expect((fields as { stderr: string }).stderr.length).toBe(501);
    expect((fields as { stderr: string }).stderr.startsWith("…")).toBe(true);
    expect((fields as { outputSnippet: string }).outputSnippet.length).toBe(501);
  });
});
