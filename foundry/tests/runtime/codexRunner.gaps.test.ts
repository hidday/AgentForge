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

const structuredStdout = `chatter
BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("CodexRunner.buildArgs — no 'exec' subcommand prefix", () => {
  it("prepends --model flags directly when baseArgs does not start with 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredStdout,
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

  it("prepends --model flags when baseArgs is empty", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      [],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol"] }),
    );
  });
});

describe("CodexRunner.buildStdinPayload — systemPrompt prepending", () => {
  it("prepends the system prompt before the user prompt, separated by a divider", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredStdout,
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
        systemPrompt: "You are the executor.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        stdinData: "You are the executor.\n\n---\n\nDo the task.",
      }),
    );
  });
});

describe("CodexRunner.run — runId-scoped context", () => {
  it("passes a runId-scoped context to the process runner when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredStdout,
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-1" },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { runId: "run-1", stage: "planner", runtime: "codex" },
      }),
    );
  });
});
