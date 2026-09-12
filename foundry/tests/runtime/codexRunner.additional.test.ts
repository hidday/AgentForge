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

const validStdout = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("CodexRunner.buildArgs when baseArgs does not start with 'exec'", () => {
  it("prepends --model <model> before the base args", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["--some-flag", "value"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--model", "gpt-5.6-sol", "--some-flag", "value"],
      }),
    );
  });
});

describe("CodexRunner context propagation (runId branch)", () => {
  it("passes a process context to the runner when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStdout,
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-abc" },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-abc", stage: "planner", runtime: "codex" });
  });

  it("omits the process context when input.runId is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStdout,
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

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toBeUndefined();
  });
});

describe("CodexRunner.buildStdinPayload systemPrompt branch", () => {
  it("prepends the system prompt to stdin, separated by a '---' delimiter", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStdout,
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
        prompt: "the actual task",
        systemPrompt: "You are Codex.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are Codex.\n\n---\n\nthe actual task");
  });

  it("passes the prompt unmodified when no systemPrompt is given", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStdout,
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
      { prompt: "just the task", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("just the task");
  });
});
