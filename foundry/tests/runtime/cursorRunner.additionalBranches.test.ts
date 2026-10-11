import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CursorRunner } from "../../src/runtime/cursorRunner.js";
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

describe("CursorRunner.buildStdinPayload — systemPrompt branch", () => {
  it("prepends the system prompt before the user prompt, separated by a divider", async () => {
    const processRunner = makeMockProcessRunner(okResult);
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "model-x", logger as never);

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

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        stdinData: "You are a rigorous engineer.\n\n---\n\nImplement the feature.",
      }),
    );
  });

  it("uses the prompt verbatim with no divider when systemPrompt is absent", async () => {
    const processRunner = makeMockProcessRunner(okResult);
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "model-x", logger as never);

    await runner.run(
      { prompt: "Implement the feature.", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ stdinData: "Implement the feature." }),
    );
  });
});

describe("CursorRunner — process context (runId) ternary", () => {
  it("passes a context object to the process runner when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner(okResult);
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "model-x", logger as never);

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-55" },
      "planner",
      echoSchema,
    );

    const { context } = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(context).toEqual({ runId: "run-55", stage: "planner", runtime: "cursor" });
  });
});

describe("CursorRunner tailSnippet — truncation branch on long output", () => {
  it("truncates a very long outputSnippet/stderr to a tail with an ellipsis prefix", async () => {
    const longResult = "Z".repeat(900) + "[TAIL]";
    const longStderr = "E".repeat(700) + "[ERR_TAIL]";
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: longResult }),
      stderr: longStderr,
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "model-x", logger as never);

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet.startsWith("…")).toBe(true);
    expect(logFields.outputSnippet).toContain("[TAIL]");
    expect(logFields.stderr.startsWith("…")).toBe(true);
    expect(logFields.stderr).toContain("[ERR_TAIL]");
  });
});

describe("CursorRunner.unwrapJsonEnvelope — valid JSON without a string 'result' field", () => {
  it("returns the raw stdout unchanged when parsed JSON has no string 'result' property", async () => {
    // Valid JSON, but not the expected envelope shape (e.g. result is missing,
    // or is not a string) -- must fall through to returning raw output.
    const stdout = JSON.stringify({ type: "status", ok: true });
    const processRunner = makeMockProcessRunner({
      stdout,
      stderr: "",
      exitCode: 1,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(processRunner as never, "cursor", [], "model-x", logger as never);

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    const [logFields] = logger.error.mock.calls[0]!;
    expect(logFields.outputSnippet).toContain(stdout);
  });
});
