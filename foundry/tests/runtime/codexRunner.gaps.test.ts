import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CodexRunner } from "../../src/runtime/codexRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Covers CodexRunner branches not exercised by the existing codexRunner.test.ts:
// buildArgs when baseArgs[0] isn't "exec", the systemPrompt stdin branch, the
// runId/context wiring, and the success path with exitCode 0.

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

const validBlock = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
  success: true,
  stage: "planner",
  payload: { value: "ok" },
})}\nEND_STRUCTURED_OUTPUT`;

describe("CodexRunner.buildArgs", () => {
  it("prepends --model flags (not inserted after a subcommand) when baseArgs[0] is not 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["--flag-only"],
      "gpt-5.6-sol",
      makeMockLogger() as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol", "--flag-only"] }),
    );
  });

  it("prepends --model flags when baseArgs is empty", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
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

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol"] }),
    );
  });

  it("uses the runner's default model when input.model is not provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
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

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["exec", "--model", "gpt-5.6-sol", "-"] }),
    );
  });
});

describe("CodexRunner.buildStdinPayload", () => {
  it("prepends the systemPrompt with a separator when input.systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
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
      {
        prompt: "do the task",
        systemPrompt: "You are an expert reviewer.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are an expert reviewer.\n\n---\n\ndo the task");
  });

  it("uses the prompt verbatim as stdin when no systemPrompt is provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
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

    await runner.run({ prompt: "just the prompt", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("just the prompt");
  });
});

describe("CodexRunner.run — context wiring and success path", () => {
  it("passes a context object to processRunner.execute when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-abc" },
      "reviewer",
      echoSchema,
    );

    const call = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(call.context).toEqual({ runId: "run-abc", stage: "reviewer", runtime: "codex" });
  });

  it("omits the context object when input.runId is absent", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
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

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "reviewer", echoSchema);

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toBeUndefined();
  });

  it("returns success:true and parsed payload with no logged error on a clean exitCode 0 run", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
      stderr: "",
      exitCode: 0,
      durationMs: 321,
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
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(out.success).toBe(true);
    expect(out.parsed.payload.value).toBe("ok");
    expect(out.durationMs).toBe(321);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
