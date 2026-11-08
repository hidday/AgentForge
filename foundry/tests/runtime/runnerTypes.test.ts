import { describe, it, expect } from "vitest";
import type {
  ProcessResult,
  AgentInput,
  AgentOutput,
  ProcessContext,
  ProcessSpawnOptions,
} from "../../src/runtime/runnerTypes.js";

// runnerTypes.ts is a type-only module (interfaces compile to nothing in JS).
// This test imports it directly so the v8 coverage instrumenter has a
// module record to attribute (rather than reporting a phantom 0/0/0/0 file),
// and exercises the shapes to guard against accidental breaking changes to
// the exported interfaces.
describe("runnerTypes", () => {
  it("loads as a module at runtime (type-only exports compile to an empty module)", async () => {
    // runnerTypes.ts contains only `export interface` declarations, which
    // erase completely at compile time. A static `import type { ... }` is
    // elided by esbuild and never touches the module at runtime, which is
    // why coverage otherwise reports a phantom 0/0/0/0 for this file. A
    // dynamic import forces Node/V8 to actually load and instrument the
    // compiled (empty) module, which is the only way to attribute coverage
    // to a type-only source file.
    const mod = await import("../../src/runtime/runnerTypes.js");
    expect(mod).toBeDefined();
  });

  it("ProcessResult shape accepts the documented fields", () => {
    const result: ProcessResult = {
      stdout: "out",
      stderr: "err",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    };
    expect(result.exitCode).toBe(0);
  });

  it("AgentInput shape accepts required and optional fields", () => {
    const input: AgentInput = {
      prompt: "do the thing",
      workingDirectory: "/workspace",
      timeoutMs: 1000,
    };
    const withOptional: AgentInput = {
      ...input,
      systemPrompt: "system",
      env: { FOO: "bar" },
      runId: "run-1",
      model: "claude-opus",
    };
    expect(withOptional.model).toBe("claude-opus");
  });

  it("AgentOutput shape carries parsed payload, success and stage", () => {
    const output: AgentOutput<{ ok: boolean }> = {
      raw: "{}",
      parsed: { ok: true },
      success: true,
      stage: "planner",
      durationMs: 5,
    };
    expect(output.parsed.ok).toBe(true);
  });

  it("ProcessContext and ProcessSpawnOptions shapes compose together", () => {
    const context: ProcessContext = {
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    };
    const options: ProcessSpawnOptions = {
      command: "claude",
      args: [],
      cwd: "/workspace",
      timeoutMs: 1000,
      context,
    };
    expect(options.context?.runId).toBe("run-1");
  });
});
