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

const okResult: ProcessResult = {
  stdout: 'BEGIN_STRUCTURED_OUTPUT\n{"success":true,"stage":"planner","payload":{"value":"ok"}}\nEND_STRUCTURED_OUTPUT',
  stderr: "",
  exitCode: 0,
  durationMs: 10,
  timedOut: false,
};

describe("CodexRunner.buildArgs — when baseArgs does not start with 'exec'", () => {
  it("prepends --model <model> to the front of baseArgs", async () => {
    const processRunner = makeMockProcessRunner(okResult);
    const logger = makeMockLogger();
    const runner = new CodexRunner(processRunner as never, "codex", ["--yolo"], "gpt-5.6-sol", logger as never);

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol", "--yolo"] }),
    );
  });

  it("prepends --model when baseArgs is empty", async () => {
    const processRunner = makeMockProcessRunner(okResult);
    const logger = makeMockLogger();
    const runner = new CodexRunner(processRunner as never, "codex", [], "gpt-5.6-sol", logger as never);

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol"] }),
    );
  });
});

describe("CodexRunner — process context (runId) ternary", () => {
  it("passes a context object to the process runner when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner(okResult);
    const logger = makeMockLogger();
    const runner = new CodexRunner(processRunner as never, "codex", ["exec", "-"], "gpt-5.6-sol", logger as never);

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-99" },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toEqual({ runId: "run-99", stage: "planner", runtime: "codex" });
  });
});

describe("CodexRunner.buildStdinPayload — systemPrompt branch", () => {
  it("prepends the system prompt before the user prompt, separated by a divider", async () => {
    const processRunner = makeMockProcessRunner(okResult);
    const logger = makeMockLogger();
    const runner = new CodexRunner(processRunner as never, "codex", ["exec", "-"], "gpt-5.6-sol", logger as never);

    await runner.run(
      {
        prompt: "Implement the feature.",
        systemPrompt: "You are a rigorous engineer.",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are a rigorous engineer.\n\n---\n\nImplement the feature.");
  });

  it("uses the prompt verbatim with no divider when systemPrompt is absent", async () => {
    const processRunner = makeMockProcessRunner(okResult);
    const logger = makeMockLogger();
    const runner = new CodexRunner(processRunner as never, "codex", ["exec", "-"], "gpt-5.6-sol", logger as never);

    await runner.run(
      { prompt: "Implement the feature.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("Implement the feature.");
  });
});
