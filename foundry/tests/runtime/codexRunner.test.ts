import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CodexRunner } from "../../src/runtime/codexRunner.js";
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

describe("CodexRunner.run() error reporting", () => {
  it("includes a tail snippet of stdout in the error log on non-zero exit with no structured output", async () => {
    const longThinking = "thinking step ".repeat(100);
    const stdout = `${longThinking}\nfinal: connection reset by peer`;

    const processRunner = makeMockProcessRunner({
      stdout,
      stderr: "",
      exitCode: 1,
      durationMs: 5000,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await expect(
      runner.run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "executor",
        echoSchema,
      ),
    ).rejects.toThrow();

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["exec", "--model", "gpt-5.6-sol", "-"],
      }),
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logFields, logMessage] = logger.error.mock.calls[0]!;
    expect(logMessage).toBe(
      "Codex CLI returned non-zero exit code with no structured output",
    );
    expect(logFields).toMatchObject({ stage: "executor", exitCode: 1, stderr: "" });
    expect(logFields.outputSnippet).toContain("connection reset by peer");
  });

  it("does not log an error when stdout contains BEGIN_STRUCTURED_OUTPUT, even on non-zero exit", async () => {
    const stdout = `chatter
BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

    const processRunner = makeMockProcessRunner({
      stdout,
      stderr: "",
      exitCode: 1,
      durationMs: 50,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "gpt-5.6-terra" },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["exec", "--model", "gpt-5.6-terra", "-"],
      }),
    );

    expect(out.parsed.payload.value).toBe("ok");
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("CodexRunner — argument and stdin building", () => {
  it("prepends --model flags (not inserted after a subcommand) when baseArgs does not start with 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n" + JSON.stringify({ ok: true }) + "\nEND_STRUCTURED_OUTPUT",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    // baseArgs[0] is "--yolo", not "exec" -> falls into the plain-prepend branch.
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["--yolo", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      z.object({ ok: z.boolean() }),
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--model", "gpt-5.6-sol", "--yolo", "-"],
      }),
    );
  });

  it("prepends the system prompt to the stdin payload, separated by a divider, when input.systemPrompt is provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n" + JSON.stringify({ ok: true }) + "\nEND_STRUCTURED_OUTPUT",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run(
      {
        prompt: "Do the task.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
        systemPrompt: "You are a careful executor.",
      },
      "executor",
      z.object({ ok: z.boolean() }),
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        stdinData: "You are a careful executor.\n\n---\n\nDo the task.",
      }),
    );
  });

  it("uses the raw prompt as stdin when input.systemPrompt is not provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n" + JSON.stringify({ ok: true }) + "\nEND_STRUCTURED_OUTPUT",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run(
      { prompt: "Do the task.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      z.object({ ok: z.boolean() }),
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "Do the task." }),
    );
  });

  it("passes a context with runId/stage/runtime to processRunner.execute when input.runId is provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n" + JSON.stringify({ ok: true }) + "\nEND_STRUCTURED_OUTPUT",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run(
      { prompt: "Do the task.", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-789" },
      "executor",
      z.object({ ok: z.boolean() }),
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-789", stage: "executor", runtime: "codex" });
  });

  it("passes context: undefined to processRunner.execute when input.runId is not provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n" + JSON.stringify({ ok: true }) + "\nEND_STRUCTURED_OUTPUT",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run(
      { prompt: "Do the task.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      z.object({ ok: z.boolean() }),
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toBeUndefined();
  });
});
