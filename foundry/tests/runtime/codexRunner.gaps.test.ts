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

const goodStdout = `BEGIN_STRUCTURED_OUTPUT\n${JSON.stringify({
  success: true,
  stage: "planner",
  payload: { value: "ok" },
})}\nEND_STRUCTURED_OUTPUT`;

describe("CodexRunner.buildArgs — non-'exec' base args branch", () => {
  it("prepends --model flags when baseArgs does not start with 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: goodStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["--some-other-flag"],
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
        args: ["--model", "gpt-5.6-sol", "--some-other-flag"],
      }),
    );
  });

  it("prepends --model flags for empty baseArgs", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: goodStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(processRunner as never, "codex", [], "gpt-5.6-sol", logger as never);

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

describe("CodexRunner.buildStdinPayload — systemPrompt handling", () => {
  it("prepends the system prompt separated by '---' when provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: goodStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
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

  it("uses the raw prompt as stdin when no systemPrompt is provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: goodStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
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
