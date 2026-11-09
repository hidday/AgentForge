import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 60_000,
    ...overrides,
  };
}

function extractStructuredPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  const json = stdout.slice(begin + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  return JSON.parse(json);
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape for every call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "planner" }));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
    expect(typeof result.stdout).toBe("string");
  });

  describe("claude tool routing", () => {
    it("routes stdin mentioning open questions to research to the answer-researcher output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ stdinData: "Here are the Open Questions To Research for this issue" }),
      );
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("answer-researcher");
      expect(parsed.success).toBe(true);
    });

    it("routes stdin mentioning plan revision to the plan-reviser output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Please perform a plan revision" }));
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviser");
    });

    it("routes stdin mentioning 'lead engineer' to the plan-reviser output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ stdinData: "You are acting as the lead engineer on this task" }),
      );
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviser");
    });

    it("routes stdin mentioning 'implementation plan' to the planner output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ stdinData: "Write an implementation plan for this issue" }),
      );
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("planner");
      expect((parsed.payload as { planVersion: number }).planVersion).toBe(1);
    });

    it("routes stdin mentioning 'remediat' to the remediation output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Begin remediation of the findings" }));
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("remediation");
      expect((parsed.payload as { readyForHumanReview: boolean }).readyForHumanReview).toBe(true);
    });

    it("falls back to the executor output for unrecognized claude stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "do the implementation work" }));
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("executor");
    });

    it("matches a claude command given as a full path (endsWith check)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner task" }),
      );
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("planner");
    });

    it("treats missing stdinData as empty (falls through to executor)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: undefined }));
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("executor");
    });
  });

  describe("codex tool routing", () => {
    it("routes stdin mentioning plan review to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "This plan under review needs feedback" }),
      );
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("matches a codex command given as a full path (endsWith check)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan-reviewer pass" }),
      );
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code review call and approved on the second, from the same handler instance", async () => {
      const handler = createMockProcessHandler();

      const first = await handler(baseOptions({ command: "codex", stdinData: "review the code" }));
      const firstParsed = extractStructuredPayload(first.stdout) as { payload: { overallVerdict: string } };
      expect(firstParsed.payload.overallVerdict).toBe("changes_requested");

      const second = await handler(baseOptions({ command: "codex", stdinData: "review the code" }));
      const secondParsed = extractStructuredPayload(second.stdout) as {
        payload: { overallVerdict: string };
      };
      expect(secondParsed.payload.overallVerdict).toBe("approved");
    });

    it("tracks code-review call counts independently per handler instance", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      const a1 = await handlerA(baseOptions({ command: "codex", stdinData: "review" }));
      const b1 = await handlerB(baseOptions({ command: "codex", stdinData: "review" }));

      expect((extractStructuredPayload(a1.stdout) as { payload: { overallVerdict: string } }).payload.overallVerdict).toBe(
        "changes_requested",
      );
      expect((extractStructuredPayload(b1.stdout) as { payload: { overallVerdict: string } }).payload.overallVerdict).toBe(
        "changes_requested",
      );
    });
  });

  describe("unrecognized tool", () => {
    it("returns a failure payload for a command that is neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "some-other-tool" }));
      const parsed = extractStructuredPayload(result.stdout);
      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload).toEqual({});
    });
  });
});
