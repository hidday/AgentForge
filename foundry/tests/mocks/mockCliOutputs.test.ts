import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/repo",
    timeoutMs: 1000,
    ...overrides,
  };
}

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText);
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "please act as executor" }));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  describe("claude command routing", () => {
    it("routes to answer-researcher output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Open questions to research: q1" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
    });

    it("routes to plan-reviser output on 'plan revision'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/bin/claude", stdinData: "Produce a plan revision now" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("routes to plan-reviser output on 'lead engineer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ stdinData: "You are the lead engineer for this task" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("routes to planner output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ stdinData: "Write an implementation plan for this issue" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("routes to remediation output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Please remediate the findings" }));
      expect(extractPayload(result.stdout).stage).toBe("remediation");
    });

    it("falls back to executor output for unrecognized claude prompts", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "just do the work" }));
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });

    it("falls back to executor output when stdinData is undefined", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({}));
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });
  });

  describe("codex command routing", () => {
    it("routes to plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "The plan under review is ready" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("routes to plan-reviewer output via '/path/to/codex'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan-reviewer instructions" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call, approved on the second", async () => {
      const handler = createMockProcessHandler();
      const first = await handler(baseOptions({ command: "codex", stdinData: "review this code" }));
      const firstPayload = extractPayload(first.stdout) as { payload: { overallVerdict: string } };
      expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

      const second = await handler(
        baseOptions({ command: "codex", stdinData: "review this code" }),
      );
      const secondPayload = extractPayload(second.stdout) as { payload: { overallVerdict: string } };
      expect(secondPayload.payload.overallVerdict).toBe("approved");
    });
  });

  describe("unrecognized command routing", () => {
    it("returns a failure payload for a non-claude, non-codex command", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "agent", stdinData: "anything" }));
      const parsed = extractPayload(result.stdout);
      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload).toEqual({});
    });
  });
});
