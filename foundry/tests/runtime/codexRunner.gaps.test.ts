import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CodexRunner } from "../../src/runtime/codexRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Narrowly targeted tests for the lines left uncovered by codexRunner.test.ts:
//   - buildArgs(): the non-"exec" baseArgs branch (model flags prepended, not inserted after "exec")
//   - buildStdinPayload(): the systemPrompt-prefixing branch

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

const structuredOutput = `BEGIN_STRUCTURED_OUTPUT
${JSON.stringify({ success: true, stage: "planner", payload: { value: "ok" } })}
END_STRUCTURED_OUTPUT`;

describe("CodexRunner.buildArgs — non-'exec' baseArgs", () => {
  it("prepends --model <model> before baseArgs when baseArgs[0] is not 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredOutput,
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

  it("prepends --model even when baseArgs is empty", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredOutput,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
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

describe("CodexRunner — context passed to processRunner.execute when runId is set", () => {
  it("includes { runId, stage, runtime } context when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredOutput,
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

    const { context } = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(context).toEqual({ runId: "run-789", stage: "planner", runtime: "codex" });
  });
});

describe("CodexRunner.buildStdinPayload — systemPrompt prefixing", () => {
  it("prepends systemPrompt + separator before the user prompt on stdin when set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredOutput,
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
        prompt: "the user task",
        systemPrompt: "You are Codex, a reviewer.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are Codex, a reviewer.\n\n---\n\nthe user task");
  });

  it("uses the prompt alone on stdin when systemPrompt is unset", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredOutput,
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
      { prompt: "the user task", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("the user task");
  });
});
