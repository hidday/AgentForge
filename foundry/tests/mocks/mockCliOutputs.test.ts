import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function extractStage(stdout: string): string {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const json = JSON.parse(stdout.slice(start, end).trim()) as { stage: string; payload: unknown };
  return json.stage;
}

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/repo",
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "planner prompt: implementation plan" }));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("routes a Claude answer-researcher prompt to the researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "Here are the open questions to research" }),
    );
    expect(extractStage(result.stdout)).toBe("answer-researcher");
  });

  it("routes a Claude plan-revision prompt to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are the lead engineer doing a plan revision" }));
    expect(extractStage(result.stdout)).toBe("plan-reviser");
  });

  it("routes a Claude planner prompt to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Create an implementation plan" }));
    expect(extractStage(result.stdout)).toBe("planner");
  });

  it("routes a Claude remediation prompt to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Please remediate the review findings" }));
    expect(extractStage(result.stdout)).toBe("remediation");
  });

  it("defaults an unrecognized Claude prompt to the executor output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "do some general work" }));
    expect(extractStage(result.stdout)).toBe("executor");
  });

  it("matches a command that is a path ending in /claude", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "implementation plan" }),
    );
    expect(extractStage(result.stdout)).toBe("planner");
  });

  it("routes a Codex plan-review prompt to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "the plan under review is attached" }),
    );
    expect(extractStage(result.stdout)).toBe("plan-reviewer");
  });

  it("alternates Codex code-review calls between changes_requested and approved", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(baseOptions({ command: "codex", stdinData: "review the diff" }));
    const second = await handler(baseOptions({ command: "codex", stdinData: "review the diff" }));

    expect(extractStage(first.stdout)).toBe("reviewer");
    expect(extractStage(second.stdout)).toBe("reviewer");
    expect(first.stdout).toContain("changes_requested");
    expect(second.stdout).toContain('"overallVerdict": "approved"');
  });

  it("tracks codex call counts independently per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    await handlerA(baseOptions({ command: "codex", stdinData: "review the diff" }));
    const firstOnB = await handlerB(baseOptions({ command: "codex", stdinData: "review the diff" }));

    expect(firstOnB.stdout).toContain("changes_requested");
  });

  it("returns a failed planner stub for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor" }));

    const start = result.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
    const end = result.stdout.indexOf(STRUCTURED_OUTPUT_END);
    const json = JSON.parse(result.stdout.slice(start, end).trim()) as { success: boolean };
    expect(json.success).toBe(false);
  });
});
