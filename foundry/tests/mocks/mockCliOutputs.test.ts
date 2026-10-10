import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions, ProcessResult } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 10_000,
    ...overrides,
  };
}

function extractPayload(result: ProcessResult): { stage: string; success: boolean; payload: unknown } {
  const begin = result.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = result.stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  const jsonText = result.stdout.slice(begin + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  return JSON.parse(jsonText);
}

describe("createMockProcessHandler", () => {
  it("returns well-formed ProcessResult envelopes regardless of branch taken", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "planner task" }));

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
  });

  describe("claude command branches", () => {
    it("returns the answer-researcher output when stdin mentions answer-researcher", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are the answer-researcher agent." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("answer-researcher");
      expect((parsed.payload as { answers: unknown[] }).answers).toHaveLength(2);
    });

    it("returns the answer-researcher output when stdin mentions 'open questions to research'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "## Open Questions To Research" }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("answer-researcher");
    });

    it("returns the plan-reviser output when stdin mentions 'plan revision'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Perform a plan revision now." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("plan-reviser");
      expect((parsed.payload as { revision: unknown }).revision).toBeDefined();
    });

    it("returns the plan-reviser output when stdin mentions 'plan-reviser'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are the plan-reviser." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("plan-reviser");
    });

    it("returns the plan-reviser output when stdin mentions 'lead engineer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Acting as lead engineer, revise the plan." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("plan-reviser");
    });

    it("returns the planner output when stdin mentions 'planner'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "You are the planner agent." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("planner");
      expect((parsed.payload as { planVersion: number }).planVersion).toBe(1);
    });

    it("returns the planner output when stdin mentions 'implementation plan'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Write an implementation plan." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("planner");
    });

    it("returns the remediation output when stdin mentions 'remediat'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Perform remediation of the findings." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("remediation");
      expect((parsed.payload as { readyForHumanReview: boolean }).readyForHumanReview).toBe(true);
    });

    it("falls back to the executor output when stdin matches none of the other keyword groups", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Implement the approved plan." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("executor");
      expect((parsed.payload as { prDraftCreated: boolean }).prDraftCreated).toBe(true);
    });

    it("falls back to the executor output when stdinData is undefined", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: undefined }));
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("executor");
    });
  });

  describe("codex command branches", () => {
    it("returns the plan-reviewer output when stdin mentions 'plan review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "Conduct a plan review of this proposal." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("plan-reviewer");
      expect((parsed.payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
    });

    it("returns the plan-reviewer output when stdin mentions 'plan-reviewer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "You are the plan-reviewer." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("returns the plan-reviewer output when stdin mentions 'plan under review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "Here is the plan under review." }),
      );
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second, using one handler instance", async () => {
      const handler = createMockProcessHandler();

      const first = await handler(
        baseOptions({ command: "codex", stdinData: "Perform a code review of this diff." }),
      );
      const firstParsed = extractPayload(first);
      expect(firstParsed.stage).toBe("reviewer");
      expect((firstParsed.payload as { overallVerdict: string }).overallVerdict).toBe(
        "changes_requested",
      );
      expect((firstParsed.payload as { reviewId: string }).reviewId).toBe("rev-001");

      const second = await handler(
        baseOptions({ command: "codex", stdinData: "Perform a code review of this diff." }),
      );
      const secondParsed = extractPayload(second);
      expect(secondParsed.stage).toBe("reviewer");
      expect((secondParsed.payload as { overallVerdict: string }).overallVerdict).toBe("approved");
      expect((secondParsed.payload as { reviewId: string }).reviewId).toBe("rev-002");
    });

    it("keeps returning approved on a third and later call against the same handler", async () => {
      const handler = createMockProcessHandler();
      const codeReviewOpts = baseOptions({ command: "codex", stdinData: "code review please" });

      await handler(codeReviewOpts);
      await handler(codeReviewOpts);
      const third = await handler(codeReviewOpts);

      const parsed = extractPayload(third);
      expect((parsed.payload as { overallVerdict: string }).overallVerdict).toBe("approved");
    });

    it("tracks separate counters per handler instance (a fresh handler restarts at call 1)", async () => {
      const codeReviewOpts = baseOptions({ command: "codex", stdinData: "code review please" });

      const handlerA = createMockProcessHandler();
      const firstOnA = extractPayload(await handlerA(codeReviewOpts));
      expect((firstOnA.payload as { overallVerdict: string }).overallVerdict).toBe(
        "changes_requested",
      );

      const handlerB = createMockProcessHandler();
      const firstOnB = extractPayload(await handlerB(codeReviewOpts));
      expect((firstOnB.payload as { overallVerdict: string }).overallVerdict).toBe(
        "changes_requested",
      );
    });

    it("matches codex by an exact command value of 'codex'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "plan review" }));
      const parsed = extractPayload(result);
      expect(parsed.stage).toBe("plan-reviewer");
    });
  });

  describe("neither claude nor codex", () => {
    it("falls back to the failure wrap when the command matches neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "some-other-tool", stdinData: "anything" }));
      const parsed = extractPayload(result);
      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload).toEqual({});
    });
  });

  it("matches claude/codex by a path ending in the binary name, not just an exact match", async () => {
    const handler = createMockProcessHandler();
    const claudeResult = await handler(
      baseOptions({ command: "/usr/bin/env claude".split(" ")[1], stdinData: "planner" }),
    );
    expect(extractPayload(claudeResult).stage).toBe("planner");
  });
});
