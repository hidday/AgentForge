import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { CodexRunner } from "../../src/runtime/codexRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Closes remaining coverage gaps in codexRunner.ts:
//   - buildArgs(): the non-"exec" branch that prepends --model flags
//     directly (line ~78) instead of inserting after the subcommand
//   - buildStdinPayload(): the systemPrompt-prefixing branch (lines ~86-87)

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

describe("CodexRunner.buildArgs() — non-'exec' baseArgs", () => {
  it("prepends --model flags directly when baseArgs[0] is not 'exec'", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n{}\nEND_STRUCTURED_OUTPUT",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(
      processRunner as never,
      "codex",
      ["--some-flag", "value"],
      "gpt-5.6-sol",
      logger as never,
    );

    await expect(
      runner.run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      ),
    ).rejects.toThrow();

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--model", "gpt-5.6-sol", "--some-flag", "value"],
      }),
    );
  });

  it("prepends --model flags when baseArgs is empty", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n{}\nEND_STRUCTURED_OUTPUT",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    const logger = makeMockLogger();
    const runner = new CodexRunner(processRunner as never, "codex", [], "gpt-5.6-sol", logger as never);

    await expect(
      runner.run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema),
    ).rejects.toThrow();

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--model", "gpt-5.6-sol"] }),
    );
  });
});

describe("CodexRunner — process context wiring", () => {
  it("passes a context object to processRunner.execute when input.runId is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n{}\nEND_STRUCTURED_OUTPUT",
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

    await runner
      .run(
        { prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000, runId: "run-abc" },
        "planner",
        echoSchema,
      )
      .catch(() => {});

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { runId: "run-abc", stage: "planner", runtime: "codex" },
      }),
    );
  });

  it("omits context when input.runId is not set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n{}\nEND_STRUCTURED_OUTPUT",
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

    await runner
      .run({ prompt: "x", workingDirectory: "/tmp", timeoutMs: 1000 }, "planner", echoSchema)
      .catch(() => {});

    expect(processRunner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ context: undefined }),
    );
  });
});

describe("CodexRunner.buildStdinPayload() — systemPrompt", () => {
  it("prepends the system prompt to the stdin payload with a separator when set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n{}\nEND_STRUCTURED_OUTPUT",
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

    await runner
      .run(
        {
          prompt: "do the task",
          systemPrompt: "You are a reviewer.",
          workingDirectory: "/tmp",
          timeoutMs: 1000,
        },
        "planner",
        echoSchema,
      )
      .catch(() => {
        // stdout has no structured block, so parse() throws; we only care
        // about the stdin payload sent to the process runner.
      });

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("You are a reviewer.\n\n---\n\ndo the task");
  });

  it("uses the raw prompt as stdin when no systemPrompt is set", async () => {
    const processRunner = makeMockProcessRunner({
      stdout: "BEGIN_STRUCTURED_OUTPUT\n{}\nEND_STRUCTURED_OUTPUT",
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

    await runner
      .run(
        { prompt: "do the task", workingDirectory: "/tmp", timeoutMs: 1000 },
        "planner",
        echoSchema,
      )
      .catch(() => {});

    const { stdinData } = processRunner.execute.mock.calls[0]![0] as { stdinData: string };
    expect(stdinData).toBe("do the task");
  });
});
