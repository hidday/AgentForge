import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";

/**
 * Extracts and parses the JSON payload embedded between the structured
 * output markers in a mock stdout string.
 */
function extractStructuredOutput(stdout: string): unknown {
  const beginIdx = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const endIdx = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(beginIdx).toBeGreaterThanOrEqual(0);
  expect(endIdx).toBeGreaterThan(beginIdx);
  const jsonSlice = stdout.slice(beginIdx + STRUCTURED_OUTPUT_BEGIN.length, endIdx).trim();
  return JSON.parse(jsonSlice);
}

function baseOptions(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp/work",
    timeoutMs: 60_000,
    ...overrides,
  };
}

describe("createMockProcessHandler", () => {
  describe("generic ProcessResult shape", () => {
    it("resolves a well-formed ProcessResult for any input", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "implementation plan please" }));

      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(typeof result.stdout).toBe("string");
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(1500);
      expect(result.durationMs).toBeLessThan(2000);
    });

    it("defaults stdinContent to empty string when stdinData is undefined", async () => {
      const handler = createMockProcessHandler();
      // No stdinData at all -- the handler must not throw and must fall through
      // to the claude "else" branch (executor output) since isClaude is true
      // and none of the keyword checks can match an empty string.
      const result = await handler(baseOptions({ command: "claude", stdinData: undefined }));
      const parsed = extractStructuredOutput(result.stdout) as { stage: string };
      expect(parsed.stage).toBe("executor");
    });
  });

  describe("claude command dispatch", () => {
    it.each([
      ["answer-researcher", "please run the answer-researcher stage"],
      ["open questions to research", "Here are the open questions to research for this plan"],
    ])("returns the answer-researcher output when stdin mentions %s", async (_label, stdin) => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: stdin }));
      const parsed = extractStructuredOutput(result.stdout) as {
        success: boolean;
        stage: string;
        payload: { answers: unknown[]; summary: string };
      };
      expect(parsed.success).toBe(true);
      expect(parsed.stage).toBe("answer-researcher");
      expect(Array.isArray(parsed.payload.answers)).toBe(true);
      expect(parsed.payload.answers).toHaveLength(2);
      expect(parsed.payload.summary).toContain("Researched 2 open questions");
    });

    it.each([
      ["plan revision", "Please perform a plan revision based on the review"],
      ["plan-reviser", "You are acting as the plan-reviser for this run"],
      ["lead engineer", "As the lead engineer, revise this plan"],
    ])("returns the plan-reviser output when stdin mentions %s", async (_label, stdin) => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: stdin }));
      const parsed = extractStructuredOutput(result.stdout) as {
        stage: string;
        payload: { revision: { originalPlanVersion: number; revisedPlanVersion: number }; revisedPlan: { planVersion: number } };
      };
      expect(parsed.stage).toBe("plan-reviser");
      expect(parsed.payload.revision.originalPlanVersion).toBe(1);
      expect(parsed.payload.revision.revisedPlanVersion).toBe(2);
      expect(parsed.payload.revisedPlan.planVersion).toBe(2);
    });

    it.each([
      ["planner", "Act as the planner for this issue"],
      ["implementation plan", "Produce an implementation plan for this issue"],
    ])("returns the planner output when stdin mentions %s", async (_label, stdin) => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: stdin }));
      const parsed = extractStructuredOutput(result.stdout) as {
        stage: string;
        payload: { planVersion: number; steps: unknown[] };
      };
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload.planVersion).toBe(1);
      expect(parsed.payload.steps).toHaveLength(5);
    });

    it("returns the remediation output when stdin mentions remediation", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Please perform remediation on the findings" }),
      );
      const parsed = extractStructuredOutput(result.stdout) as {
        stage: string;
        payload: { readyForHumanReview: boolean; resolution: unknown[] };
      };
      expect(parsed.stage).toBe("remediation");
      expect(parsed.payload.readyForHumanReview).toBe(true);
      expect(parsed.payload.resolution).toHaveLength(3);
    });

    it("falls back to the executor output for unmatched claude stdin content", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Just implement the feature described above." }),
      );
      const parsed = extractStructuredOutput(result.stdout) as {
        stage: string;
        payload: { filesChanged: string[]; prDraftCreated: boolean };
      };
      expect(parsed.stage).toBe("executor");
      expect(parsed.payload.prDraftCreated).toBe(true);
      expect(parsed.payload.filesChanged.length).toBeGreaterThan(0);
    });

    it("matches claude via command equality as well as a path suffix", async () => {
      const handler = createMockProcessHandler();
      const exact = await handler(baseOptions({ command: "claude", stdinData: "planner" }));
      const pathSuffix = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner" }),
      );
      const exactParsed = extractStructuredOutput(exact.stdout) as { stage: string };
      const pathParsed = extractStructuredOutput(pathSuffix.stdout) as { stage: string };
      expect(exactParsed.stage).toBe("planner");
      expect(pathParsed.stage).toBe("planner");
    });

    it("matching is case-insensitive via lowercasing of stdinData", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "ACT AS THE PLANNER FOR THIS ISSUE" }),
      );
      const parsed = extractStructuredOutput(result.stdout) as { stage: string };
      expect(parsed.stage).toBe("planner");
    });
  });

  describe("codex command dispatch", () => {
    it.each([
      ["plan review", "Begin plan review of the submitted plan"],
      ["plan-reviewer", "You are the plan-reviewer agent"],
      ["plan under review", "The plan under review is attached below"],
    ])("returns the plan-reviewer output when stdin mentions %s", async (_label, stdin) => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: stdin }));
      const parsed = extractStructuredOutput(result.stdout) as {
        stage: string;
        payload: { overallVerdict: string; findings: unknown[] };
      };
      expect(parsed.stage).toBe("plan-reviewer");
      expect(parsed.payload.overallVerdict).toBe("changes_requested");
      expect(parsed.payload.findings).toHaveLength(2);
    });

    it("matches codex via command equality as well as a path suffix", async () => {
      const handler = createMockProcessHandler();
      const exact = await handler(baseOptions({ command: "codex", stdinData: "plan review" }));
      const pathSuffix = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan review" }),
      );
      const exactParsed = extractStructuredOutput(exact.stdout) as { stage: string };
      const pathParsed = extractStructuredOutput(pathSuffix.stdout) as { stage: string };
      expect(exactParsed.stage).toBe("plan-reviewer");
      expect(pathParsed.stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved thereafter, on the same handler instance", async () => {
      const handler = createMockProcessHandler();
      const codeReviewOptions = baseOptions({
        command: "codex",
        stdinData: "Please review this diff for correctness",
      });

      const first = await handler(codeReviewOptions);
      const firstParsed = extractStructuredOutput(first.stdout) as {
        payload: { reviewId: string; overallVerdict: string; findings: unknown[] };
      };
      expect(firstParsed.payload.reviewId).toBe("rev-001");
      expect(firstParsed.payload.overallVerdict).toBe("changes_requested");
      expect(firstParsed.payload.findings).toHaveLength(3);

      const second = await handler(codeReviewOptions);
      const secondParsed = extractStructuredOutput(second.stdout) as {
        payload: { reviewId: string; overallVerdict: string; findings: unknown[] };
      };
      expect(secondParsed.payload.reviewId).toBe("rev-002");
      expect(secondParsed.payload.overallVerdict).toBe("approved");
      expect(secondParsed.payload.findings).toHaveLength(1);

      // A third call on the same handler should remain "approved" -- the
      // threshold is codeReviewCalls <= 1, so every call after the first stays
      // in the approved branch.
      const third = await handler(codeReviewOptions);
      const thirdParsed = extractStructuredOutput(third.stdout) as {
        payload: { overallVerdict: string };
      };
      expect(thirdParsed.payload.overallVerdict).toBe("approved");
    });

    it("tracks call counts independently per handler instance", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();
      const opts = baseOptions({ command: "codex", stdinData: "review this code change" });

      // Exhaust handler A's first (changes_requested) slot.
      const aFirst = await handlerA(opts);
      const aFirstParsed = extractStructuredOutput(aFirst.stdout) as {
        payload: { overallVerdict: string };
      };
      expect(aFirstParsed.payload.overallVerdict).toBe("changes_requested");

      // A fresh handler instance must start its own counter from zero, so its
      // first code-review call is also changes_requested, not approved.
      const bFirst = await handlerB(opts);
      const bFirstParsed = extractStructuredOutput(bFirst.stdout) as {
        payload: { overallVerdict: string };
      };
      expect(bFirstParsed.payload.overallVerdict).toBe("changes_requested");
    });
  });

  describe("unrecognized command dispatch", () => {
    it("returns a failure planner payload for a command that is neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "cursor", stdinData: "irrelevant content" }),
      );
      const parsed = extractStructuredOutput(result.stdout) as {
        success: boolean;
        stage: string;
        payload: Record<string, never>;
      };
      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload).toEqual({});
    });

    it("does not treat a path containing 'claude' as a match unless it ends with claude", async () => {
      const handler = createMockProcessHandler();
      // "claude-helper" does not end with "claude", so this must fall through
      // to the unrecognized-command branch, not the claude dispatch branch.
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude-helper", stdinData: "planner" }),
      );
      const parsed = extractStructuredOutput(result.stdout) as { success: boolean; stage: string };
      expect(parsed.success).toBe(false);
      expect(parsed.stage).toBe("planner");
    });
  });
});
