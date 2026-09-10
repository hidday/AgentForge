import { describe, it, expect } from "vitest";
import * as runnerTypes from "../../src/runtime/runnerTypes.js";

// runnerTypes.ts contains only `export interface` declarations, which are
// erased at compile time and never produce runtime code. v8 coverage still
// wants the module "loaded" as a JS module to instrument it; importing it
// here (as a value import, not `import type`) forces that without asserting
// anything false about its (nonexistent) runtime behavior.
describe("runnerTypes module", () => {
  it("imports without throwing and has no runtime exports (interfaces only)", () => {
    expect(runnerTypes).toBeDefined();
    expect(Object.keys(runnerTypes)).toEqual([]);
  });

  it("shapes objects that satisfy the exported interfaces", () => {
    const processResult: import("../../src/runtime/runnerTypes.js").ProcessResult = {
      stdout: "out",
      stderr: "err",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    };

    const agentInput: import("../../src/runtime/runnerTypes.js").AgentInput = {
      prompt: "p",
      workingDirectory: "/tmp",
      timeoutMs: 1000,
    };

    const agentOutput: import("../../src/runtime/runnerTypes.js").AgentOutput<{ x: number }> = {
      raw: "{}",
      parsed: { x: 1 },
      success: true,
      stage: "planner",
      durationMs: 1,
    };

    const processContext: import("../../src/runtime/runnerTypes.js").ProcessContext = {
      runId: "run-1",
      stage: "planner",
      runtime: "claude-code",
    };

    const spawnOptions: import("../../src/runtime/runnerTypes.js").ProcessSpawnOptions = {
      command: "echo",
      args: ["hi"],
      cwd: "/tmp",
      timeoutMs: 1000,
      context: processContext,
    };

    expect(processResult.exitCode).toBe(0);
    expect(agentInput.prompt).toBe("p");
    expect(agentOutput.parsed.x).toBe(1);
    expect(spawnOptions.context?.runId).toBe("run-1");
  });
});
