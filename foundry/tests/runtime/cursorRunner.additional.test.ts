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

describe("CursorRunner context propagation (runId branch)", () => {
  it("passes a process context to the runner when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok" }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "m", logger as never);

    await runner
      .run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-abc" },
        "planner",
        echoSchema,
      )
      .catch(() => {});

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-abc", stage: "planner", runtime: "cursor" });
  });

  it("omits the process context when input.runId is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok" }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "m", logger as never);

    await runner
      .run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema)
      .catch(() => {});

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toBeUndefined();
  });
});

describe("CursorRunner.buildStdinPayload systemPrompt branch", () => {
  it("prepends the system prompt to stdin, separated by a '---' delimiter", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok text" }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "m", logger as never);

    await runner
      .run(
        {
          prompt: "the actual task",
          systemPrompt: "You are Cursor.",
          workingDirectory: "/tmp",
          timeoutMs: 1000,
        },
        "planner",
        echoSchema,
      )
      .catch(() => {
        // Parsing will fail since "ok text" has no structured block; we only
        // care about the stdin payload constructed before the call.
      });

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are Cursor.\n\n---\n\nthe actual task");
  });

  it("passes the prompt unmodified when no systemPrompt is given", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: "ok text" }),
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "m", logger as never);

    await runner
      .run({ prompt: "just the task", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema)
      .catch(() => {});

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("just the task");
  });
});

describe("CursorRunner tailSnippet truncation branch", () => {
  it("truncates a long outputSnippet to a tail with an ellipsis prefix when logging a failure", async () => {
    const longResult = "Y".repeat(900) + "[END_MARKER]";
    const envelope = JSON.stringify({ type: "result", result: longResult });

    const processRunner = makeMockProcessRunner({
      stdout: envelope,
      stderr: "",
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "m", logger as never);

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[END_MARKER]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
  });
});
