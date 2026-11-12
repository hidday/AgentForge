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

const successStdout = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("CodexRunner.buildArgs — baseArgs without a leading 'exec' subcommand", () => {
  it("prepends --model <model> to baseArgs when baseArgs[0] is not 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    // baseArgs deliberately does NOT start with "exec".
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["--json", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--model", "gpt-5.6-sol", "--json", "-"],
      }),
    );
  });

  it("prepends --model <model> when baseArgs is empty", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successStdout,
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
      "gpt-5.6-terra",
      logger as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--model", "gpt-5.6-terra"],
      }),
    );
  });
});

describe("CodexRunner.buildStdinPayload — systemPrompt prepending", () => {
  it("prepends the system prompt, separated by a '---' delimiter, when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successStdout,
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
        prompt: "Implement the feature.",
        systemPrompt: "You are the executor agent.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "executor",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe(
      "You are the executor agent.\n\n---\n\nImplement the feature.",
    );
  });

  it("uses the prompt alone, with no delimiter, when input.systemPrompt is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successStdout,
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
      { prompt: "Implement the feature.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("Implement the feature.");
    expect(stdinData).not.toContain("---");
  });

  it("uses the prompt alone when input.systemPrompt is an empty string (falsy)", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: successStdout,
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
      { prompt: "Implement the feature.", systemPrompt: "", workingDirectory: "/tmp", timeoutMs: 1000 },
      "executor",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("Implement the feature.");
  });
});
