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

function extractPayload(stdout: string): { stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end)) as { stage: string; payload: unknown };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult for every call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "planner task" }));
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.durationMs).toBe("number");
  });

  describe("claude command routing", () => {
    it("routes to the answer-researcher output on matching stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "claude", stdinData: "Open questions to research" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
    });

    it("routes to the plan-reviser output on matching stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: "Plan revision needed" }));
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("routes to the planner output on matching stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "claude", stdinData: "Please write an implementation plan" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("routes to the remediation output on matching stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: "time to remediate" }));
      expect(extractPayload(result.stdout).stage).toBe("remediation");
    });

    it("defaults to the executor output for claude when nothing else matches", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: "just build it" }));
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });

    it("recognizes a full path ending in the claude binary name", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "/usr/local/bin/claude", stdinData: "just build it" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });
  });

  describe("codex command routing", () => {
    it("routes to the plan-reviewer output on matching stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        opts({ command: "codex", stdinData: "Plan under review by plan-reviewer" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second", async () => {
      const handler = createMockProcessHandler();
      const first = await handler(opts({ command: "codex", stdinData: "review this diff" }));
      const second = await handler(opts({ command: "codex", stdinData: "review this diff" }));

      const firstPayload = extractPayload(first.stdout).payload as { overallVerdict: string };
      const secondPayload = extractPayload(second.stdout).payload as { overallVerdict: string };

      expect(firstPayload.overallVerdict).toBe("changes_requested");
      expect(secondPayload.overallVerdict).toBe("approved");
    });

    it("keeps separate call counters for plan-review vs code-review calls", async () => {
      const handler = createMockProcessHandler();
      // A plan-review call should not consume a code-review counter slot.
      await handler(opts({ command: "codex", stdinData: "plan-reviewer pass" }));
      const codeReview1 = await handler(opts({ command: "codex", stdinData: "review the diff" }));
      const payload1 = extractPayload(codeReview1.stdout).payload as { overallVerdict: string };
      expect(payload1.overallVerdict).toBe("changes_requested");
    });
  });

  it("falls back to a failure planner payload when the command is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "some-other-tool", stdinData: "anything" }));
    const parsed = extractPayload(result.stdout);
    expect(parsed).toMatchObject({ stage: "planner" });
    expect((parsed as unknown as { success: boolean }).success).toBe(false);
  });

  it("treats missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude" }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });
});
