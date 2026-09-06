import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/workspace",
    timeoutMs: 60_000,
    ...overrides,
  };
}

function extractStructuredPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText) as { success: boolean; stage: string; payload: unknown };
}

describe("createMockProcessHandler", () => {
  it("returns a fresh handler function on each call", () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();
    expect(handlerA).not.toBe(handlerB);
  });

  it("resolves with the standard ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "do the planner task" }));
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
    expect(typeof result.stdout).toBe("string");
  });

  it("wraps stdout with the structured-output begin/end markers", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "planner" }));
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
    expect(result.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN)).toBeLessThan(
      result.stdout.indexOf(STRUCTURED_OUTPUT_END),
    );
  });

  describe("claude command routing", () => {
    it.each([
      ["/usr/local/bin/claude", "claude"],
      ["claude", "claude"],
    ])("recognizes claude via command %s", async (command) => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command, stdinData: "planner: implementation plan" }));
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("planner");
    });

    it("routes to the answer-researcher output on matching stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Please act as answer-researcher" }),
      );
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("answer-researcher");
    });

    it("routes to the answer-researcher output via the 'open questions to research' phrase", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Here are the OPEN QUESTIONS TO RESEARCH" }),
      );
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("answer-researcher");
    });

    it("routes to the plan-reviser output on 'plan revision'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "produce a plan revision" }));
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("plan-reviser");
    });

    it("routes to the plan-reviser output on 'lead engineer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are acting as lead engineer" }),
      );
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("plan-reviser");
    });

    it("routes to the planner output on 'implementation plan'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "write an implementation plan" }),
      );
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("planner");
    });

    it("routes to the remediation output on stdin containing 'remediat'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "begin remediation of review findings" }),
      );
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("remediation");
    });

    it("falls back to the executor output for unrecognized claude stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "implement the feature end to end" }),
      );
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("executor");
    });

    it("falls back to the executor output when stdinData is omitted entirely", async () => {
      const handler = createMockProcessHandler();
      const options = baseOptions({ command: "claude" });
      delete options.stdinData;
      const result = await handler(options);
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("executor");
    });

    it("matches routing keywords case-insensitively", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "PLANNER task ahead" }));
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("planner");
    });
  });

  describe("codex command routing", () => {
    it.each([
      ["/usr/bin/codex", "codex"],
      ["codex", "codex"],
    ])("recognizes codex via command %s", async (command) => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command, stdinData: "run a plan review" }));
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("plan-reviewer");
    });

    it("routes to plan-reviewer output on 'plan-reviewer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "acting as plan-reviewer" }));
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("plan-reviewer");
    });

    it("routes to plan-reviewer output on 'plan under review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "the plan under review is attached" }),
      );
      const { stage } = extractStructuredPayload(result.stdout);
      expect(stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first non-plan-review codex call, then approved on the second", async () => {
      const handler = createMockProcessHandler();
      const first = await handler(baseOptions({ command: "codex", stdinData: "review this code" }));
      const firstPayload = extractStructuredPayload(first.stdout);
      expect(firstPayload.stage).toBe("reviewer");
      expect((firstPayload.payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");

      const second = await handler(baseOptions({ command: "codex", stdinData: "review this code again" }));
      const secondPayload = extractStructuredPayload(second.stdout);
      expect(secondPayload.stage).toBe("reviewer");
      expect((secondPayload.payload as { overallVerdict: string }).overallVerdict).toBe("approved");
    });

    it("keeps returning approved on a third and later codex code-review call", async () => {
      const handler = createMockProcessHandler();
      await handler(baseOptions({ command: "codex", stdinData: "review this code" }));
      await handler(baseOptions({ command: "codex", stdinData: "review this code" }));
      const third = await handler(baseOptions({ command: "codex", stdinData: "review this code" }));
      const { payload } = extractStructuredPayload(third.stdout);
      expect((payload as { overallVerdict: string }).overallVerdict).toBe("approved");
    });

    it("tracks the changes_requested/approved counter independently per handler instance", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();
      await handlerA(baseOptions({ command: "codex", stdinData: "review this code" }));

      const resultB = await handlerB(baseOptions({ command: "codex", stdinData: "review this code" }));
      const { payload } = extractStructuredPayload(resultB.stdout);
      // A fresh handler's own counter starts over, so its first call is changes_requested again.
      expect((payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
    });
  });

  describe("unrecognized command", () => {
    it("returns a failure planner stub for a command that is neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "some-other-cli", stdinData: "anything" }));
      const { success, stage, payload } = extractStructuredPayload(result.stdout);
      expect(success).toBe(false);
      expect(stage).toBe("planner");
      expect(payload).toEqual({});
    });

    it("does not treat a command merely containing 'claude' as a substring as a claude match", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude-wrapper-tool", stdinData: "planner" }));
      const { success, stage } = extractStructuredPayload(result.stdout);
      expect(success).toBe(false);
      expect(stage).toBe("planner");
    });
  });
});
