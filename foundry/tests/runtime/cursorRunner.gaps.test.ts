import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CursorRunner } from "../../src/runtime/cursorRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Covers CursorRunner branches not exercised by the existing cursorRunner.test.ts:
// buildArgs, the systemPrompt stdin branch, runId/context wiring, and the
// success path with exitCode 0 (the existing suite only exercises exitCode 1).

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

describe("CursorRunner.buildArgs", () => {
  it("appends --model and --workspace to the base args", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor-agent",
      ["--base-flag"],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/work/dir", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--base-flag", "--model", "claude-4.6-sonnet", "--workspace", "/work/dir"],
      }),
    );
  });

  it("uses input.model override over the runner's default model", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor-agent",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, model: "gpt-override" },
      "planner",
      echoSchema,
    );

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-override", "--workspace", "/tmp"] }),
    );
  });
});

describe("CursorRunner.buildStdinPayload", () => {
  it("prepends the systemPrompt with a separator when provided", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor-agent",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      {
        prompt: "task body",
        systemPrompt: "system instructions",
        workingDirectory: "/tmp",
        timeoutMs: 1000,
      },
      "planner",
      echoSchema,
    );

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("system instructions\n\n---\n\ntask body");
  });

  it("uses the prompt verbatim when no systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor-agent",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run({ prompt: "just this", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema);

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("just this");
  });
});

describe("CursorRunner.run — context wiring and success path", () => {
  it("passes a context object to processRunner.execute when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor-agent",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-xyz" },
      "executor",
      echoSchema,
    );

    const call = processRunner.execute.mock.calls[0]![0] as {
      context?: { runId: string; stage: string; runtime: string };
    };
    expect(call.context).toEqual({ runId: "run-xyz", stage: "executor", runtime: "cursor" });
  });

  it("omits the context object when input.runId is absent", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor-agent",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    await runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "executor", echoSchema);

    const call = processRunner.execute.mock.calls[0]![0] as { context?: unknown };
    expect(call.context).toBeUndefined();
  });

  it("returns success:true with no logged error on a clean exitCode 0 run with a JSON envelope", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: JSON.stringify({ type: "result", result: validBlock }),
      stderr: "",
      exitCode: 0,
      durationMs: 55,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CursorRunner(
      processRunner as never,
      "cursor-agent",
      [],
      "claude-4.6-sonnet",
      logger as never,
    );

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(out.success).toBe(true);
    expect(out.parsed.payload.value).toBe("ok");
    expect(out.durationMs).toBe(55);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns success:true with a raw (non-JSON-wrapped) stdout on exitCode 0", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: validBlock,
      stderr: "",
      exitCode: 0,
      durationMs: 55,
      timedOut: false,
    });
    const runner = new CursorRunner(
      processRunner as never,
      "cursor-agent",
      [],
      "claude-4.6-sonnet",
      makeMockLogger() as never,
    );

    const out = await runner.run(
      { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
      "planner",
      echoSchema,
    );

    expect(out.success).toBe(true);
    expect(out.parsed.payload.value).toBe("ok");
  });
});
