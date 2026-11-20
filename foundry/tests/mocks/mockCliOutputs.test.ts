import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 120_000,
    stdinData: "",
    ...overrides,
  };
}

function extractPayload(stdout: string): { stage: string; success: boolean; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText) as { stage: string; success: boolean; payload: unknown };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "implementation plan" }));

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  describe("claude command routing", () => {
    it("routes to the answer-researcher output on 'answer-researcher' stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Stage: answer-researcher" }),
      );
      const parsed = extractPayload(result.stdout);
      expect(parsed.stage).toBe("answer-researcher");
    });

    it("routes to the answer-researcher output on 'open questions to research' stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Here are the Open Questions To Research" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
    });

    it("routes to the plan-reviser output on 'plan-reviser' stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "This is the plan-reviser stage" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("routes to the plan-reviser output on 'lead engineer' stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are a lead engineer revising the plan" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("routes to the planner output on 'planner' stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "You are the planner" }));
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("routes to the planner output on 'implementation plan' stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Produce an implementation plan" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("routes to the remediation output on 'remediat' stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Perform remediation of the findings" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("remediation");
    });

    it("falls back to the executor output for claude when no other keyword matches", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "implement the feature now" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });

    it("matches claude when the command is a path ending in /claude", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "implementation plan" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("is case-insensitive when matching stdin keywords", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "IMPLEMENTATION PLAN" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });
  });

  describe("codex command routing", () => {
    it("routes to the plan-reviewer output on 'plan review' stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "Plan Review time" }));
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("routes to the plan-reviewer output on 'plan under review' stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "The plan under review is attached" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second", async () => {
      const handler = createMockProcessHandler();

      const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const firstParsed = extractPayload(first.stdout);
      expect(firstParsed.stage).toBe("reviewer");
      expect((firstParsed.payload as { overallVerdict: string }).overallVerdict).toBe(
        "changes_requested",
      );

      const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const secondParsed = extractPayload(second.stdout);
      expect(secondParsed.stage).toBe("reviewer");
      expect((secondParsed.payload as { overallVerdict: string }).overallVerdict).toBe("approved");
    });

    it("keeps the code-review call counter independent from a prior plan-review call", async () => {
      const handler = createMockProcessHandler();

      await handler(baseOptions({ command: "codex", stdinData: "plan review please" }));
      const codeReview = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));

      const parsed = extractPayload(codeReview.stdout);
      expect((parsed.payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
    });

    it("matches codex when the command is a path ending in /codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan review" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });
  });

  describe("unknown command", () => {
    it("returns a failed planner-shaped output for a command that is neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "cursor", stdinData: "anything" }));

      const parsed = extractPayload(result.stdout);
      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload).toEqual({});
    });
  });

  describe("handler state isolation", () => {
    it("tracks call counts independently across different createMockProcessHandler() instances", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      await handlerA(baseOptions({ command: "codex", stdinData: "review this diff" }));
      // handlerB's first code-review call should still be changes_requested,
      // proving call counts are not shared across handler instances.
      const result = await handlerB(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const parsed = extractPayload(result.stdout);
      expect((parsed.payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
    });

    it("treats missing stdinData as an empty string without throwing", async () => {
      const handler = createMockProcessHandler();
      const { stdinData, ...rest } = baseOptions({ command: "claude" });
      const result = await handler(rest as ProcessSpawnOptions);
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });
  });
});
