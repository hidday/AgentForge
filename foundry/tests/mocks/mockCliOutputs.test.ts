import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function opts(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const beginIdx = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const endIdx = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(beginIdx).toBeGreaterThanOrEqual(0);
  expect(endIdx).toBeGreaterThan(beginIdx);
  const jsonText = stdout.slice(beginIdx + STRUCTURED_OUTPUT_BEGIN.length, endIdx).trim();
  return JSON.parse(jsonText) as { success: boolean; stage: string; payload: unknown };
}

describe("createMockProcessHandler", () => {
  it("returns well-formed ProcessResult metadata (exitCode 0, no stderr, not timed out)", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "implementation plan" }));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  describe("claude command routing", () => {
    it("routes 'answer-researcher' stdin to the answer-researcher output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: "run the answer-researcher stage" }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("answer-researcher");
    });

    it("routes 'open questions to research' stdin to the answer-researcher output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "claude", stdinData: "Here are the Open Questions to Research" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("answer-researcher");
    });

    it("routes 'plan revision' stdin to the plan-reviser output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: "produce a plan revision" }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviser");
    });

    it("routes 'lead engineer' stdin to the plan-reviser output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "claude", stdinData: "You are the Lead Engineer revising this plan" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviser");
    });

    it("routes 'planner'/'implementation plan' stdin to the planner output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "claude", stdinData: "Write an implementation plan" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("planner");
    });

    it("routes 'remediat' stdin to the remediation output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: "please remediate these findings" }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("remediation");
    });

    it("falls back to the executor output for unrecognized claude stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: "implement the feature" }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("executor");
    });

    it("falls back to the executor output when stdinData is undefined", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: undefined }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("executor");
    });

    it("matches a claude command given as an absolute path ending in 'claude'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "/usr/local/bin/claude", stdinData: "implementation plan" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("planner");
    });

    it("matches stdin content case-insensitively", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "claude", stdinData: "REMEDIATE THESE ISSUES NOW" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("remediation");
    });
  });

  describe("codex command routing", () => {
    it("routes 'plan review' stdin to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "codex", stdinData: "conduct a plan review" }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("routes 'plan-reviewer' stdin to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "codex", stdinData: "you are the plan-reviewer" }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("routes 'plan under review' stdin to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "codex", stdinData: "Here is the plan under review" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second", async () => {
      const handler = createMockProcessHandler();
      const first = await handler(opts({ command: "codex", stdinData: "please review this diff" }));
      const firstParsed = extractPayload(first.stdout) as { payload: { overallVerdict: string } };
      expect(firstParsed.stage).toBe("reviewer");
      expect(firstParsed.payload.overallVerdict).toBe("changes_requested");

      const second = await handler(opts({ command: "codex", stdinData: "please review this diff" }));
      const secondParsed = extractPayload(second.stdout) as { payload: { overallVerdict: string } };
      expect(secondParsed.stage).toBe("reviewer");
      expect(secondParsed.payload.overallVerdict).toBe("approved");
    });

    it("keeps returning approved on a third code-review call", async () => {
      const handler = createMockProcessHandler();
      await handler(opts({ command: "codex", stdinData: "review this" }));
      await handler(opts({ command: "codex", stdinData: "review this" }));
      const third = await handler(opts({ command: "codex", stdinData: "review this" }));
      const parsed = extractPayload(third.stdout) as { payload: { overallVerdict: string } };
      expect(parsed.payload.overallVerdict).toBe("approved");
    });

    it("tracks code-review call count independently from plan-review calls", async () => {
      const handler = createMockProcessHandler();
      // A plan-review call must not consume a code-review "call slot".
      await handler(opts({ command: "codex", stdinData: "plan review please" }));
      const codeReview = await handler(opts({ command: "codex", stdinData: "review this diff" }));
      const parsed = extractPayload(codeReview.stdout) as { payload: { overallVerdict: string } };
      expect(parsed.payload.overallVerdict).toBe("changes_requested");
    });
  });

  describe("unrecognized command", () => {
    it("returns a failure envelope for a command that is neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "cursor-agent", stdinData: "anything" }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload).toEqual({});
    });
  });
});
