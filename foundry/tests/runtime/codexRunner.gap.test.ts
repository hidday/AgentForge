import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CodexRunner } from "../../src/runtime/codexRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Targets the small remaining gaps in codexRunner.ts that codexRunner.test.ts
// does not exercise:
//   - buildArgs()'s non-"exec" branch (baseArgs[0] !== "exec")
//   - buildStdinPayload() prepending systemPrompt to the prompt

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

const structuredStdout = `BEGIN_STRUCTURED_OUTPUT
{"success":true,"stage":"planner","payload":{"value":"ok"}}
END_STRUCTURED_OUTPUT`;

describe("CodexRunner.buildArgs — non-exec baseArgs", () => {
  it("prepends --model <model> to baseArgs when baseArgs[0] is not 'exec'", async () => {
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
      ["--full-auto", "-"],
      "gpt-5.6-sol",
      logger as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--model", "gpt-5.6-sol", "--full-auto", "-"],
      }),
    );
  });

  it("prepends --model <model> when baseArgs is empty", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: structuredStdout,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(processRunner as never, "codex", [], "gpt-5.6-sol", logger as never);

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol"] }),
    );
  });
});

describe("CodexRunner.buildStdinPayload — systemPrompt prefix", () => {
  it("prepends the system prompt, separated by '---', ahead of the user prompt on stdin", async () => {
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

    const out = await runner.run(
      {
        prompt: "Implement the feature.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
        systemPrompt: "You are the executor agent.",
      },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        stdinData: "You are the executor agent.\n\n---\n\nImplement the feature.",
      }),
    );
    expect(out.parsed.payload.value).toBe("ok");
  });

  it("uses the raw prompt as stdin when no systemPrompt is given", async () => {
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

    await runner.run({ prompt: "Just the prompt.", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "Just the prompt." }),
    );
  });
});

describe("CodexRunner — process context passed to the process runner when runId is set", () => {
  it("builds a { runId, stage, runtime: 'codex' } context when input.runId is present", async () => {
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
