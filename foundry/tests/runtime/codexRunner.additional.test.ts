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

const validStructuredOutput = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("CodexRunner — buildArgs() model flag placement", () => {
  it("inserts --model after the subcommand when baseArgs starts with 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toEqual(["exec", "--model", "gpt-5.6-sol", "-"]);
  });

  it("prepends --model flags when baseArgs does NOT start with 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["--some-other-flag"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toEqual(["--model", "gpt-5.6-sol", "--some-other-flag"]);
  });

  it("prepends --model flags with no other args when baseArgs is empty", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      [],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { args } = processRunner.execute.mock.calls[0]![0] as { args: string[] };
    expect(args).toEqual(["--model", "gpt-5.6-sol"]);
  });
});

describe("CodexRunner — buildStdinPayload() systemPrompt handling", () => {
  it("prepends the system prompt, separated by '---', when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "the task", systemPrompt: "You are the planner.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are the planner.\n\n---\n\nthe task");
  });

  it("uses the raw prompt as stdin when no systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validStructuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["exec", "-"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
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
