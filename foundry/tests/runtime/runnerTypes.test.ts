import { describe, it, expect } from "vitest";
import type {
  ProcessResult,
  AgentInput,
  AgentOutput,
  ProcessContext,
  ProcessSpawnOptions,
} from "../../src/runtime/runnerTypes.js";

// src/runtime/runnerTypes.ts contains ONLY `export interface` declarations
// (ProcessResult, AgentInput, AgentOutput, ProcessContext, ProcessSpawnOptions)
// — no runtime code, no functions, no classes, no executable statements.
// TypeScript interfaces are erased entirely at compile time, so the emitted
// JS module is empty; there is nothing for a coverage instrumenter to track
// and nothing a test can "execute" to move its coverage off 0%. This file
// exists only to document/confirm that fact (via `import type`, which is
// also fully erased) rather than to claim real coverage of a type-only module.
describe("runnerTypes.ts is type-only (no executable statements)", () => {
  it("exports only types — using them via `import type` compiles to no runtime code", () => {
    // These are purely compile-time type annotations; nothing here touches
    // any value exported from runnerTypes.ts at runtime.
    const processResult: ProcessResult = {
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 0,
      timedOut: false,
    };
    const agentInput: AgentInput = {
      prompt: "p",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
    };
    const agentOutput: AgentOutput<{ x: number }> = {
      raw: "raw",
      parsed: { x: 1 },
      success: true,
      stage: "planner",
      durationMs: 5,
    };
    const context: ProcessContext = { runId: "r1", stage: "planner", runtime: "claude-code" };
    const spawnOptions: ProcessSpawnOptions = {
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
    };

    expect(processResult.exitCode).toBe(0);
    expect(agentInput.prompt).toBe("p");
    expect(agentOutput.parsed.x).toBe(1);
    expect(context.runtime).toBe("claude-code");
    expect(spawnOptions.command).toBe("claude");
  });
});
