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

const goodStdout = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
  success: true,
  stage: "planner",
  payload: { value: "ok" },
})}\nEND_STRUCTURED_OUTPUT`;

describe("CursorRunner.buildStdinPayload — systemPrompt handling", () => {
  it("prepends the system prompt separated by '---' when provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: goodStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
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

    await runner.run(
      {
        prompt: "the actual task",
        systemPrompt: "You are Cursor.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are Cursor.\n\n---\n\nthe actual task");
  });

  it("uses the raw prompt as stdin when no systemPrompt is provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: goodStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
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

    await runner.run(
      { prompt: "just the task", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("just the task");
  });
});

describe("CursorRunner.unwrapJsonEnvelope — non-envelope fallback", () => {
  it("falls back to raw stdout when it is not JSON at all", async () => {
    const raw = "not json output";
    const processRunner = makeMockProcessRunner({
      stdout: raw,
      stderr: "boom",
      exitCode: 1,
      durationMs: 5,
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

    const [logFields, logMessage] = logger.error.mock.calls[0]!;
    expect(logMessage).toBe(
      "Cursor CLI returned non-zero exit code with no structured output",
    );
    expect(logFields.outputSnippet).toContain(raw);
  });

  it("falls back to raw stdout when it is JSON but has no string 'result' field", async () => {
    const raw = JSON.stringify({ type: "result", result: 42 });
    const processRunner = makeMockProcessRunner({
      stdout: raw,
      stderr: "",
      exitCode: 1,
      durationMs: 5,
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
    expect(logFields.outputSnippet).toContain(raw);
  });
});
