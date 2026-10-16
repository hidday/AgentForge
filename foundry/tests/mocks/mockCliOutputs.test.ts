import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return JSON.parse(stdout.slice(start, end).trim());
}

function opts(command: string, stdinData?: string): ProcessSpawnOptions {
  return {
    command,
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    stdinData,
  };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("claude", "do the thing"));

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
    expect(typeof result.stdout).toBe("string");
  });

  describe("claude command routing", () => {
    it.each([
      ["open questions to research", "answer-researcher"],
      ["this is a plan revision task", "plan-reviser"],
      ["you are the plan-reviser", "plan-reviser"],
      ["you are the lead engineer", "plan-reviser"],
    ])("routes stdin %j to the %s stage", async (stdin, expectedStage) => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("/usr/local/bin/claude", stdin));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe(expectedStage);
    });

    it("routes answer-researcher stdin to the answer-researcher stage", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("claude", "ANSWER-RESEARCHER please proceed"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("answer-researcher");
      expect(payload.success).toBe(true);
    });

    it("routes planner stdin to the planner stage", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("claude", "You are the planner for this issue"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("planner");
    });

    it("routes 'implementation plan' stdin to the planner stage", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("claude", "Write an implementation plan"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("planner");
    });

    it("routes remediation stdin to the remediation stage", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("claude", "Please remediate the review findings"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("remediation");
    });

    it("falls back to the executor stage for unrecognized claude stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("claude", "implement the feature end to end"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("executor");
    });

    it("falls back to the executor stage when stdinData is omitted entirely", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("claude", undefined));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("executor");
    });

    it("matches a command that merely ends with 'claude' (full path)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("/opt/homebrew/bin/claude", "answer-researcher"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("answer-researcher");
    });
  });

  describe("codex command routing", () => {
    it("routes 'plan review' stdin to the plan-reviewer stage", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("codex", "conduct the plan review now"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("plan-reviewer");
    });

    it("routes 'plan-reviewer' stdin to the plan-reviewer stage", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("codex", "you are the plan-reviewer"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("plan-reviewer");
    });

    it("routes 'plan under review' stdin to the plan-reviewer stage", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("codex", "the plan under review is attached"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("plan-reviewer");
    });

    it("returns 'changes_requested' on the first code-review call, then 'approved' on the second call, for the same handler instance", async () => {
      const handler = createMockProcessHandler();

      const first = await handler(opts("codex", "review this diff"));
      const firstPayload = extractPayload(first.stdout) as { payload: { overallVerdict: string } };
      expect(firstPayload.stage).toBe("reviewer");
      expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

      const second = await handler(opts("codex", "review this diff again"));
      const secondPayload = extractPayload(second.stdout) as {
        payload: { overallVerdict: string };
      };
      expect(secondPayload.stage).toBe("reviewer");
      expect(secondPayload.payload.overallVerdict).toBe("approved");
    });

    it("tracks the changes_requested/approved counter independently per handler instance", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      await handlerA(opts("codex", "review this diff"));
      // handlerB's first review call should still be "changes_requested" even though
      // handlerA has already consumed one call.
      const resultB = await handlerB(opts("codex", "review this diff"));
      const payloadB = extractPayload(resultB.stdout) as { payload: { overallVerdict: string } };
      expect(payloadB.payload.overallVerdict).toBe("changes_requested");
    });

    it("matches a command that merely ends with 'codex' (full path)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("/usr/local/bin/codex", "plan review please"));
      const payload = extractPayload(result.stdout);
      expect(payload.stage).toBe("plan-reviewer");
    });
  });

  describe("unrecognized commands", () => {
    it("returns a failure payload with an empty object for a non-claude, non-codex command", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts("agent", "anything"));
      const payload = extractPayload(result.stdout);
      expect(payload.success).toBe(false);
      expect(payload.stage).toBe("planner");
      expect(payload.payload).toEqual({});
    });
  });
});
