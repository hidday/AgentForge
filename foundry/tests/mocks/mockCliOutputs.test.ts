import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end).trim());
}

function makeOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape for every call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions());

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.stdout).toBe("string");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });

  describe("claude command routing", () => {
    it("routes to the answer-researcher output when stdin mentions answer-researcher", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "You are the answer-researcher agent" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
    });

    it("routes to the answer-researcher output when stdin mentions 'open questions to research'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/local/bin/claude", stdinData: "Open Questions To Research:" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
    });

    it("routes to the plan-reviser output when stdin mentions plan revision", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Perform a plan revision as lead engineer" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
    });

    it("routes to the planner output when stdin mentions planner or implementation plan", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "You are the planner agent" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("routes to the remediation output when stdin mentions remediation", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Begin remediation of findings" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("remediation");
    });

    it("defaults to the executor output for claude when no keyword matches", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "claude", stdinData: "implement the feature" }));
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });

    it("matches claude command keyword case-insensitively via stdin lowercasing", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "PLANNER mode engaged" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });
  });

  describe("codex command routing", () => {
    it("routes to the plan-reviewer output when stdin mentions plan review", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "codex", stdinData: "Plan under review for correctness" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("alternates code-review verdicts: first call changes_requested, second approved", async () => {
      const handler = createMockProcessHandler();
      const first = await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));
      const second = await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));

      const firstPayload = extractPayload(first.stdout);
      const secondPayload = extractPayload(second.stdout);
      expect(firstPayload.stage).toBe("reviewer");
      expect(secondPayload.stage).toBe("reviewer");
      expect((firstPayload.payload as { overallVerdict: string }).overallVerdict).toBe(
        "changes_requested",
      );
      expect((secondPayload.payload as { overallVerdict: string }).overallVerdict).toBe("approved");
    });

    it("keeps returning approved after the second code-review call (call count only increments)", async () => {
      const handler = createMockProcessHandler();
      await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));
      await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));
      const third = await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));

      expect((extractPayload(third.stdout).payload as { overallVerdict: string }).overallVerdict).toBe(
        "approved",
      );
    });

    it("tracks code-review and plan-review call counts independently", async () => {
      const handler = createMockProcessHandler();
      const review1 = await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));
      const planReview = await handler(
        makeOptions({ command: "codex", stdinData: "Plan under review" }),
      );
      const review2 = await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));

      expect(
        (extractPayload(review1.stdout).payload as { overallVerdict: string }).overallVerdict,
      ).toBe("changes_requested");
      expect(extractPayload(planReview.stdout).stage).toBe("plan-reviewer");
      expect(
        (extractPayload(review2.stdout).payload as { overallVerdict: string }).overallVerdict,
      ).toBe("approved");
    });
  });

  describe("unknown command", () => {
    it("falls back to a failed planner envelope for a command that is neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "cursor", stdinData: "anything" }));

      const payload = extractPayload(result.stdout);
      expect(payload.success).toBe(false);
      expect(payload.stage).toBe("planner");
      expect(payload.payload).toEqual({});
    });
  });

  it("gives each call to createMockProcessHandler its own independent call counters", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    await handlerA(makeOptions({ command: "codex", stdinData: "Review this diff" }));

    const resultB = await handlerB(makeOptions({ command: "codex", stdinData: "Review this diff" }));

    expect(
      (extractPayload(resultB.stdout).payload as { overallVerdict: string }).overallVerdict,
    ).toBe("changes_requested");
  });
});
