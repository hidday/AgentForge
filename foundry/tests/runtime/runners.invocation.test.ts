import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ClaudeCodeRunner } from "../../src/runtime/claudeCodeRunner.js";
import { CodexRunner } from "../../src/runtime/codexRunner.js";
import { CursorRunner } from "../../src/runtime/cursorRunner.js";
import type { ProcessResult } from "../../src/runtime/runnerTypes.js";

// Companion to the per-runner test files (which focus on error logging):
// argument building, stdin payload construction, run context, model
// override and Claude NDJSON envelope unwrapping.

const schema = z.object({ v: z.string() });
const structured = 'BEGIN_STRUCTURED_OUTPUT\n{"v":"ok"}\nEND_STRUCTURED_OUTPUT';

function proc(stdout: string, exitCode = 0, stderr = ""): ProcessResult {
  return { stdout, stderr, exitCode, durationMs: 12, timedOut: false };
}

function deps(result: ProcessResult) {
  return {
    processRunner: { execute: vi.fn().mockResolvedValue(result) },
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
}

const baseInput = { prompt: "USER PROMPT", workingDirectory: "/repo", timeoutMs: 5000 };

describe("ClaudeCodeRunner invocation", () => {
  function make(result: ProcessResult, baseArgs = ["-p", "--output-format", "json"]) {
    const d = deps(result);
    const runner = new ClaudeCodeRunner(
      d.processRunner as never,
      "claude",
      baseArgs,
      "default-model",
      d.logger as never,
    );
    return { runner, ...d };
  }

  it("passes the system prompt as a flag, prompt via stdin, and tags the run context", async () => {
    const { runner, processRunner } = make(proc(JSON.stringify({ result: structured })));

    const out = await runner.run(
      { ...baseInput, systemPrompt: "SYS", runId: "run-1", env: { A: "1" } },
      "planner",
      schema,
    );

    expect(out).toMatchObject({ parsed: { v: "ok" }, success: true, stage: "planner", durationMs: 12 });
    expect(processRunner.execute).toHaveBeenCalledWith({
      command: "claude",
      args: ["-p", "--output-format", "json", "--model", "default-model", "--system-prompt", "SYS"],
      cwd: "/repo",
      env: { A: "1" },
      timeoutMs: 5000,
      stdinData: "USER PROMPT",
      context: { runId: "run-1", stage: "planner", runtime: "claude-code" },
    });
  });

  it("omits --system-prompt and context when not provided, and honours a per-call model", async () => {
    const { runner, processRunner } = make(proc(structured));

    await runner.run({ ...baseInput, model: "override-model" }, "planner", schema);

    const call = processRunner.execute.mock.calls[0][0];
    expect(call.args).toEqual(["-p", "--output-format", "json", "--model", "override-model"]);
    expect(call.args).not.toContain("--system-prompt");
    expect(call.context).toBeUndefined();
  });

  it("unwraps the last NDJSON result line, skipping blank and non-JSON lines", async () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "result", result: "stale" }),
      "not json at all",
      JSON.stringify({ type: "assistant", message: "thinking" }),
      JSON.stringify({ type: "result", result: structured }),
      "",
      "   ",
    ].join("\n");
    const { runner } = make(proc(ndjson));

    const out = await runner.run(baseInput, "planner", schema);

    expect(out.raw).toBe(structured);
    expect(out.parsed).toEqual({ v: "ok" });
  });

  it("ignores NDJSON result lines whose result is not a string", async () => {
    const ndjson = [
      JSON.stringify({ type: "result", result: structured }),
      JSON.stringify({ type: "result", result: { nested: true } }),
    ].join("\n");
    const { runner } = make(proc(ndjson));

    const out = await runner.run(baseInput, "planner", schema);

    expect(out.raw).toBe(structured);
  });

  it("falls back to raw stdout when no envelope can be found", async () => {
    const raw = `plain log line\n${structured}`;
    const { runner } = make(proc(raw));

    const out = await runner.run(baseInput, "planner", schema);

    expect(out.raw).toBe(raw);
  });

  it("chatRun surfaces an NDJSON is_error result as an API error", async () => {
    const ndjson = [
      JSON.stringify({ type: "system" }),
      JSON.stringify({ type: "result", is_error: true, result: "API Error: overloaded" }),
    ].join("\n");
    const { runner, logger } = make(proc(ndjson, 0));

    await expect(runner.chatRun(baseInput, "chat")).rejects.toThrow(
      "Claude CLI API error: API Error: overloaded",
    );
    expect(logger.error.mock.calls[0][0]).toMatchObject({ upstreamApiError: true, exitCode: 0 });
  });

  it("chatRun returns NDJSON-unwrapped text and passes run context", async () => {
    const ndjson = JSON.stringify({ type: "result", result: "Here is my answer" });
    const { runner, processRunner } = make(proc(ndjson));

    const out = await runner.chatRun({ ...baseInput, runId: "run-2" }, "chat");

    expect(out).toEqual({ text: "Here is my answer", durationMs: 12 });
    expect(processRunner.execute.mock.calls[0][0].context).toEqual({
      runId: "run-2",
      stage: "chat",
      runtime: "claude-code",
    });
  });
});

describe("CodexRunner invocation", () => {
  function make(result: ProcessResult, baseArgs: string[]) {
    const d = deps(result);
    const runner = new CodexRunner(
      d.processRunner as never,
      "codex",
      baseArgs,
      "gpt-default",
      d.logger as never,
    );
    return { runner, ...d };
  }

  it("inserts --model right after the exec subcommand and prepends the system prompt to stdin", async () => {
    const { runner, processRunner } = make(proc(structured), ["exec", "--full-auto", "-"]);

    const out = await runner.run(
      { ...baseInput, systemPrompt: "SYSTEM RULES", runId: "run-3" },
      "executor",
      schema,
    );

    expect(out).toMatchObject({ raw: structured, parsed: { v: "ok" }, success: true });
    const call = processRunner.execute.mock.calls[0][0];
    expect(call.args).toEqual(["exec", "--model", "gpt-default", "--full-auto", "-"]);
    expect(call.stdinData).toBe("SYSTEM RULES\n\n---\n\nUSER PROMPT");
    expect(call.context).toEqual({ runId: "run-3", stage: "executor", runtime: "codex" });
  });

  it("prepends --model when there is no exec subcommand and sends the bare prompt without a system prompt", async () => {
    const { runner, processRunner } = make(proc(structured), ["--quiet"]);

    await runner.run({ ...baseInput, model: "o-custom" }, "executor", schema);

    const call = processRunner.execute.mock.calls[0][0];
    expect(call.args).toEqual(["--model", "o-custom", "--quiet"]);
    expect(call.stdinData).toBe("USER PROMPT");
    expect(call.context).toBeUndefined();
  });

  it("reports success=false for a non-zero exit that still produced structured output", async () => {
    const { runner, logger } = make(proc(structured, 2), ["exec"]);

    const out = await runner.run(baseInput, "executor", schema);

    expect(out.success).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("CursorRunner invocation", () => {
  function make(result: ProcessResult) {
    const d = deps(result);
    const runner = new CursorRunner(
      d.processRunner as never,
      "cursor-agent",
      ["-p", "--output-format", "json"],
      "cursor-default",
      d.logger as never,
    );
    return { runner, ...d };
  }

  it("adds --model and --workspace args and prepends the system prompt to stdin", async () => {
    const { runner, processRunner } = make(proc(JSON.stringify({ result: structured })));

    const out = await runner.run(
      { ...baseInput, systemPrompt: "SYS", runId: "run-4" },
      "reviewer",
      schema,
    );

    expect(out).toMatchObject({ raw: structured, parsed: { v: "ok" }, success: true });
    const call = processRunner.execute.mock.calls[0][0];
    expect(call.args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "cursor-default",
      "--workspace",
      "/repo",
    ]);
    expect(call.stdinData).toBe("SYS\n\n---\n\nUSER PROMPT");
    expect(call.context).toEqual({ runId: "run-4", stage: "reviewer", runtime: "cursor" });
  });

  it("returns raw output when the JSON envelope has no string result", async () => {
    const raw = JSON.stringify({ result: 42 });
    const { runner } = make(proc(raw));

    await expect(runner.run(baseInput, "reviewer", schema)).rejects.toThrow(/Could not find/);
  });

  it("tail-truncates long stderr and output in the failure log", async () => {
    const longOut = "o".repeat(600) + "TAIL";
    const { runner, logger } = make(proc(longOut, 1, "e".repeat(700)));

    await expect(runner.run(baseInput, "reviewer", schema)).rejects.toThrow();

    const fields = logger.error.mock.calls[0][0];
    expect(fields.stderr).toBe(`…${"e".repeat(500)}`);
    expect(fields.outputSnippet).toHaveLength(501);
    expect(fields.outputSnippet.endsWith("TAIL")).toBe(true);
    expect(fields.outputSnippet.startsWith("…")).toBe(true);
  });
});
