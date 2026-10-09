import { describe, it, expect } from "vitest";
import type {
  ProcessResult,
  AgentInput,
  AgentOutput,
  ProcessContext,
  ProcessSpawnOptions,
} from "../../src/runtime/runnerTypes.js";

// runnerTypes.ts is a type-only module (interfaces only, no runtime exports).
// Nothing ever triggers a value-level import of it, so v8 never instruments
// the module and it shows as 0/0 in coverage. There is no runtime export to
// import, so we can't make v8 execute the module itself. Instead, we assert
// that typed object literals satisfy each exported shape, which at least
// documents and exercises the contract these runner modules rely on.

describe("runnerTypes", () => {
  it("ProcessResult shape accepts a successful result", () => {
    const result: ProcessResult = {
      stdout: "hello",
      stderr: "",
      exitCode: 0,
      durationMs: 42,
      timedOut: false,
    };
    expect(result.stdout).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("ProcessResult shape accepts a timed-out result", () => {
    const result: ProcessResult = {
      stdout: "",
      stderr: "killed",
      exitCode: -1,
      durationMs: 5000,
      timedOut: true,
    };
    expect(result.timedOut).toBe(true);
  });

  it("AgentInput shape accepts required and optional fields", () => {
    const minimal: AgentInput = {
      prompt: "do the thing",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
    };
    const full: AgentInput = {
      prompt: "do the thing",
      systemPrompt: "be helpful",
      workingDirectory: "/tmp",
      env: { FOO: "bar" },
      timeoutMs: 1000,
      runId: "run-1",
      model: "claude-fable-5",
    };
    expect(minimal.systemPrompt).toBeUndefined();
    expect(full.model).toBe("claude-fable-5");
  });

  it("AgentOutput shape carries parsed payload and metadata", () => {
    const output: AgentOutput<{ value: string }> = {
      raw: "raw text",
      parsed: { value: "ok" },
      success: true,
      stage: "planner",
      durationMs: 10,
    };
    expect(output.parsed.value).toBe("ok");
    expect(output.stage).toBe("planner");
  });

  it("ProcessContext and ProcessSpawnOptions shapes compose", () => {
    const context: ProcessContext = {
      runId: "run-1",
      stage: "executor",
      runtime: "claude-code",
    };
    const options: ProcessSpawnOptions = {
      command: "claude",
      args: ["--version"],
      cwd: "/tmp",
      env: { FOO: "bar" },
      timeoutMs: 1000,
      stdinData: "hello",
      context,
    };
    expect(options.context?.stage).toBe("executor");
    expect(options.stdinData).toBe("hello");
  });
});
