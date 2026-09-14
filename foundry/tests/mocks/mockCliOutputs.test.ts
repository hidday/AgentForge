import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function extractStructuredPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  const jsonText = stdout.slice(begin + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  return JSON.parse(jsonText) as { success: boolean; stage: string; payload: unknown };
}

function makeOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    stdinData: "",
    ...overrides,
  };
}

describe("createMockProcessHandler()", () => {
  describe("basic ProcessResult shape", () => {
    it("resolves a ProcessResult with exitCode 0, empty stderr, timedOut false, and a plausible durationMs", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ stdinData: "implementation plan please" }));

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(1500);
      expect(result.durationMs).toBeLessThan(2000);
      expect(typeof result.stdout).toBe("string");
    });
  });

  describe("Claude Code CLI branch (command matches claude)", () => {
    it("returns the answer-researcher output when stdin mentions 'answer-researcher'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "You are the answer-researcher agent." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("answer-researcher");
    });

    it("returns the answer-researcher output when stdin mentions 'open questions to research'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Here are the OPEN QUESTIONS TO RESEARCH." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("answer-researcher");
    });

    it("returns the plan-reviser output when stdin mentions 'plan revision'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Please prepare a plan revision." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("plan-reviser");
    });

    it("returns the plan-reviser output when stdin mentions 'lead engineer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "You are acting as the lead engineer." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("plan-reviser");
    });

    it("returns the planner output when stdin mentions 'planner'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "You are the planner." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("planner");
    });

    it("returns the planner output when stdin mentions 'implementation plan'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Write an implementation plan." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("planner");
    });

    it("returns the remediation output when stdin mentions 'remediat'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Please remediate the review findings." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("remediation");
    });

    it("falls back to the executor output for unrecognized stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "Implement the feature described above." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("executor");
    });

    it("matches on the /claude$/ suffix (e.g. an absolute binary path) as well as the literal command", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/local/bin/claude", stdinData: "planner" }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("planner");
    });

    it("stdin matching is case-insensitive", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "PLEASE REMEDIATE THIS" }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("remediation");
    });

    it("defaults stdinData to '' when omitted (falls through to executor output)", async () => {
      const handler = createMockProcessHandler();
      const { stdinData: _drop, ...rest } = makeOptions({ command: "claude" });
      const result = await handler(rest as ProcessSpawnOptions);
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("executor");
    });
  });

  describe("Codex CLI branch (command matches codex)", () => {
    it("returns the plan-reviewer output when stdin mentions 'plan review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "codex", stdinData: "Conduct a plan review." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("plan-reviewer");
    });

    it("returns the plan-reviewer output when stdin mentions 'plan-reviewer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "codex", stdinData: "You are the plan-reviewer." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("plan-reviewer");
    });

    it("returns the plan-reviewer output when stdin mentions 'plan under review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "codex", stdinData: "Here is the plan under review." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("plan-reviewer");
    });

    it("matches on the /codex$/ suffix as well as the literal command", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/local/bin/codex", stdinData: "plan review please" }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("plan-reviewer");
    });

    it("returns the changes_requested code-review output on the first non-plan-review call", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "codex", stdinData: "Review this diff for correctness." }),
      );
      const out = extractStructuredPayload(result.stdout);
      expect(out.stage).toBe("reviewer");
      expect((out.payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
    });

    it("returns the approved code-review output on the second non-plan-review call from the same handler", async () => {
      const handler = createMockProcessHandler();
      await handler(makeOptions({ command: "codex", stdinData: "Review this diff." }));
      const second = await handler(makeOptions({ command: "codex", stdinData: "Review this diff again." }));

      const out = extractStructuredPayload(second.stdout);
      expect(out.stage).toBe("reviewer");
      expect((out.payload as { overallVerdict: string }).overallVerdict).toBe("approved");
    });

    it("keeps returning the approved output on a third and later call", async () => {
      const handler = createMockProcessHandler();
      await handler(makeOptions({ command: "codex", stdinData: "review 1" }));
      await handler(makeOptions({ command: "codex", stdinData: "review 2" }));
      const third = await handler(makeOptions({ command: "codex", stdinData: "review 3" }));

      const out = extractStructuredPayload(third.stdout);
      expect((out.payload as { overallVerdict: string }).overallVerdict).toBe("approved");
    });

    it("a plan-review call does not consume a code-review call slot", async () => {
      const handler = createMockProcessHandler();
      // First call is a plan review — should not count toward the code-review sequence.
      await handler(makeOptions({ command: "codex", stdinData: "plan review" }));
      const firstCodeReview = await handler(
        makeOptions({ command: "codex", stdinData: "review this diff" }),
      );

      const out = extractStructuredPayload(firstCodeReview.stdout);
      // Still the first *code review* call, so changes_requested (not approved).
      expect((out.payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
    });
  });

  describe("unknown command branch", () => {
    it("returns a success:false planner envelope with an empty payload for an unrecognized command", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "some-other-tool", stdinData: "anything" }));

      const out = extractStructuredPayload(result.stdout);
      expect(out.success).toBe(false);
      expect(out.stage).toBe("planner");
      expect(out.payload).toEqual({});
    });
  });

  describe("handler statefulness", () => {
    it("each call to createMockProcessHandler() returns an independent handler with its own call counters", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      // Exhaust handlerA's first code-review slot.
      await handlerA(makeOptions({ command: "codex", stdinData: "review diff" }));

      // handlerB should still be on its own first call → changes_requested.
      const result = await handlerB(makeOptions({ command: "codex", stdinData: "review diff" }));
      const out = extractStructuredPayload(result.stdout);
      expect((out.payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
    });
  });
});
