import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end).trim());
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "implementation plan" }));
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("routes claude + answer-researcher stdin to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "please run the answer-researcher stage" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");

    const result2 = await handler(
      baseOptions({ stdinData: "Open questions to research: ..." }),
    );
    expect(extractPayload(result2.stdout).stage).toBe("answer-researcher");
  });

  it("routes claude + plan-revision-shaped stdin to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    for (const stdinData of ["Plan Revision requested", "plan-reviser pass", "You are the lead engineer"]) {
      const result = await handler(baseOptions({ stdinData }));
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    }
  });

  it("routes claude + planner-shaped stdin to the planner output", async () => {
    const handler = createMockProcessHandler();
    const a = await handler(baseOptions({ stdinData: "You are the planner" }));
    expect(extractPayload(a.stdout).stage).toBe("planner");
    const b = await handler(baseOptions({ stdinData: "Write an implementation plan" }));
    expect(extractPayload(b.stdout).stage).toBe("planner");
  });

  it("routes claude + remediation-shaped stdin to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Begin remediation of findings" }));
    expect(extractPayload(result.stdout).stage).toBe("remediation");
  });

  it("falls back to the executor output for unrecognized claude stdin", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "do the implementation work" }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("defaults stdinData to empty string when omitted, still matching claude's fallback", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: undefined }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("matches claude by exact command name as well as a path ending in claude", async () => {
    const handler = createMockProcessHandler();
    const viaPath = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "implementation plan" }),
    );
    expect(extractPayload(viaPath.stdout).stage).toBe("planner");

    const viaExact = await handler(baseOptions({ command: "claude", stdinData: "implementation plan" }));
    expect(extractPayload(viaExact.stdout).stage).toBe("planner");
  });

  it("routes codex + plan-review-shaped stdin to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "This plan under review looks solid" }),
    );
    const payload = extractPayload(result.stdout);
    expect(payload.stage).toBe("plan-reviewer");
  });

  it("alternates codex code-review calls between changes_requested and approved", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const firstPayload = extractPayload(first.stdout) as { payload: { overallVerdict: string } };
    expect(firstPayload.stage).toBe("reviewer");
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

    const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const secondPayload = extractPayload(second.stdout) as { payload: { overallVerdict: string } };
    expect(secondPayload.stage).toBe("reviewer");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
  });

  it("tracks code-review call count independently per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const aFirst = await handlerA(baseOptions({ command: "codex", stdinData: "review" }));
    expect((extractPayload(aFirst.stdout) as { payload: { overallVerdict: string } }).payload.overallVerdict).toBe(
      "changes_requested",
    );

    // A fresh handler's counter starts over, independent of handlerA's calls.
    const bFirst = await handlerB(baseOptions({ command: "codex", stdinData: "review" }));
    expect((extractPayload(bFirst.stdout) as { payload: { overallVerdict: string } }).payload.overallVerdict).toBe(
      "changes_requested",
    );
  });

  it("falls back to a failed planner stub when the command is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor-agent", stdinData: "anything" }));
    const payload = extractPayload(result.stdout) as { success: boolean; stage: string; payload: unknown };
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
    expect(payload.payload).toEqual({});
  });
});
