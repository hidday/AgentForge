import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CursorRunner } from "../../src/runtime/cursorRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Closes remaining coverage gaps in cursorRunner.ts:
//   - buildStdinPayload(): the systemPrompt-prefixing branch (lines ~79-80)
//   - tailSnippet(): the truncation branch for long stderr/outputSnippet
//     (lines ~112-113), which only triggers above 500 chars

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

describe("CursorRunner.buildStdinPayload() — systemPrompt", () => {
  it("prepends the system prompt to the stdin payload with a separator when set", async () => {
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
      {
        prompt: "do the task",
        systemPrompt: "You are a cursor agent.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    ).catch(() => {
      // parse() will throw since "ok" has no structured block; we only
      // care about the stdin payload that was sent to the process runner.
    });

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are a cursor agent.\n\n---\n\ndo the task");
  });

  it("uses the raw prompt as stdin when no systemPrompt is set", async () => {
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

    await runner
      .run({ prompt: "do the task", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema)
      .catch(() => {});

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("do the task");
  });

  it("includes --workspace and --model in the spawned args", async () => {
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
      ["--base"],
      "claude-4.6-sonnet",
      logger as never,
    );

    await runner
      .run({ prompt: "x", workingDirectory: "/work/dir", timeoutMs: 1000 }, "planner", echoSchema)
      .catch(() => {});

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toEqual(["--base", "--model", "claude-4.6-sonnet", "--workspace", "/work/dir"]);
  });
});

describe("CursorRunner — process context wiring", () => {
  it("passes a context object to processRunner.execute when input.runId is set", async () => {
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

    await runner
      .run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-xyz" },
        "planner",
        echoSchema,
      )
      .catch(() => {});

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { runId: "run-xyz", stage: "planner", runtime: "cursor" },
      }),
    );
  });

  it("omits context when input.runId is not set", async () => {
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

    await runner
      .run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema)
      .catch(() => {});

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ context: undefined }),
    );
  });
});

describe("CursorRunner tailSnippet() truncation (via logged error fields)", () => {
  it("truncates stderr longer than 500 chars to a tail with an ellipsis prefix", async () => {
    const longStderr = "E".repeat(650) + "[STDERR_TAIL]";

    const processRunner = makeMockProcessRunner({
      stdout: "panic: short output",
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
    expect(logFields.stderr.startsWith("…")).toBe(true);
    expect(logFields.stderr).toContain("[STDERR_TAIL]");
    expect(logFields.stderr.length).toBeLessThanOrEqual(501);
  });

  it("truncates a long outputSnippet derived from the unwrapped envelope", async () => {
    const longResult = "R".repeat(650) + "[RESULT_TAIL]";

    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: longResult }),
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
    expect(logFields.outputSnippet).toContain("[RESULT_TAIL]");
    expect(logFields.outputSnippet.length).toBeLessThanOrEqual(501);
  });

  it("leaves short stderr/outputSnippet untouched (no ellipsis prefix)", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "short panic message",
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
    expect(logFields.stderr).toBe("short stderr");
    expect(logFields.outputSnippet).toBe("short panic message");
  });
});
