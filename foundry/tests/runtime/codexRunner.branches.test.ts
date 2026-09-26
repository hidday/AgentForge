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

describe("CodexRunner — buildArgs branches", () => {
  it("prepends --model flags (without an 'exec' subcommand) when baseArgs doesn't start with 'exec'", async () => {
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
      ["--some-flag"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol", "--some-flag"] }),
    );
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

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toEqual({ runId: "run-1", stage: "planner", runtime: "codex" });
  });
});

describe("CodexRunner — buildStdinPayload branches", () => {
  it("prepends the system prompt to stdin when input.systemPrompt is set", async () => {
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
      { prompt: "Do the task", systemPrompt: "You are Codex.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const call = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(call.stdinData).toBe("You are Codex.\n\n---\n\nDo the task");
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
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run({ prompt: "Do the task", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const call = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(call.stdinData).toBe("Do the task");
  });
});
