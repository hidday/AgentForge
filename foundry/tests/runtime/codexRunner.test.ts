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

describe("CodexRunner — process context propagation", () => {
  it("passes a process context to processRunner.execute when input.runId is set", async () => {
    const stdout = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\nEND_STRUCTURED_OUTPUT`;

    const processRunner = makeMockProcessRunner({
      stdout,
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-789" },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context: unknown };
    expect(context).toEqual({ runId: "run-789", stage: "planner", runtime: "codex" });
  });

  it("omits the process context when input.runId is unset", async () => {
    const stdout = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\nEND_STRUCTURED_OUTPUT`;

    const processRunner = makeMockProcessRunner({
      stdout,
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context: unknown };
    expect(context).toBeUndefined();
  });
});

describe("CodexRunner.buildArgs — non-exec baseArgs", () => {
  it("prepends --model flags without an exec subcommand when baseArgs doesn't start with 'exec'", async () => {
    const stdout = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\nEND_STRUCTURED_OUTPUT`;

    const processRunner = makeMockProcessRunner({
      stdout,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol", "-"] }),
    );
  });
});

describe("CodexRunner.buildStdinPayload — systemPrompt", () => {
  it("prepends the system prompt with a separator when input.systemPrompt is set", async () => {
    const stdout = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\nEND_STRUCTURED_OUTPUT`;

    const processRunner = makeMockProcessRunner({
      stdout,
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
        prompt: "the task",
        systemPrompt: "You are Codex.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are Codex.\n\n---\n\nthe task");
  });

  it("uses the raw prompt as stdin when systemPrompt is unset", async () => {
    const stdout = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
      success: true,
      stage: "planner",
      payload: { value: "ok" },
    })}\nEND_STRUCTURED_OUTPUT`;

    const processRunner = makeMockProcessRunner({
      stdout,
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
      { prompt: "the task", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("the task");
  });
});
