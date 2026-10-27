import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { CliOutputSchema, STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

/** Extracts and parses the structured-output JSON block, validating it against the real CLI schema. */
function extractStructuredOutput(stdout: string) {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const jsonText = stdout.slice(start + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  const json = JSON.parse(jsonText);
  return CliOutputSchema.parse(json);
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "planner: implementation plan" }));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(typeof result.stdout).toBe("string");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  describe("claude (isClaude) routing by stdin content", () => {
    it("routes 'answer-researcher' stdin to the answer-researcher output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "This is the answer-researcher task" }),
      );
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("answer-researcher");
      if (parsed.stage === "answer-researcher") {
        expect(parsed.payload.answers.length).toBeGreaterThan(0);
      }
    });

    it("routes 'open questions to research' stdin to the answer-researcher output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Open Questions To Research:\n..." }),
      );
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("answer-researcher");
    });

    it("routes 'plan revision' stdin to the plan-reviser output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "Please draft a plan revision" }));
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("plan-reviser");
      if (parsed.stage === "plan-reviser") {
        expect(parsed.payload.revision.reviewId).toBe("plan-rev-001");
        expect(parsed.payload.revisedPlan.planVersion).toBe(2);
      }
    });

    it("routes 'lead engineer' stdin to the plan-reviser output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "You are the Lead Engineer" }));
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("plan-reviser");
    });

    it("routes 'planner' stdin to the planner output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "You are the planner agent" }));
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("planner");
      if (parsed.stage === "planner") {
        expect(parsed.payload.steps.length).toBeGreaterThan(0);
        expect(parsed.payload.confidence).toBeGreaterThan(0);
      }
    });

    it("routes 'implementation plan' stdin to the planner output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Write an implementation plan" }),
      );
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("planner");
    });

    it("routes 'remediat' stdin to the remediation output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Perform remediation of review findings" }),
      );
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("remediation");
      if (parsed.stage === "remediation") {
        expect(parsed.payload.readyForHumanReview).toBe(true);
        expect(parsed.payload.resolution.length).toBeGreaterThan(0);
      }
    });

    it("falls back to the executor output for unmatched claude stdin content", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "Implement the feature per the plan" }),
      );
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("executor");
      if (parsed.stage === "executor") {
        expect(parsed.payload.filesChanged.length).toBeGreaterThan(0);
        expect(parsed.payload.checks.tests.status).toBe("pass");
      }
    });

    it("falls back to the executor output when stdinData is undefined", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude" }));
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("executor");
    });

    it("matches command 'claude' exactly, not just a suffix", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "planner" }));
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("planner");
    });

    it("matches a command ending with 'claude' (e.g. an absolute path)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner" }),
      );
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("planner");
    });

    it("is case-insensitive for stdin content matching", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "claude", stdinData: "PLANNER: IMPLEMENTATION PLAN" }),
      );
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("planner");
    });
  });

  describe("codex (isCodex) routing", () => {
    it("routes 'plan review' stdin to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "Perform a plan review" }));
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
      if (parsed.stage === "plan-reviewer") {
        expect(parsed.payload.overallVerdict).toBe("changes_requested");
        expect(parsed.payload.findings.length).toBeGreaterThan(0);
      }
    });

    it("routes 'plan-reviewer' stdin to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "role: plan-reviewer" }));
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("routes 'plan under review' stdin to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "The plan under review is attached" }),
      );
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("first code-review call returns changes_requested", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "Review this PR's code" }));
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("reviewer");
      if (parsed.stage === "reviewer") {
        expect(parsed.payload.overallVerdict).toBe("changes_requested");
        expect(parsed.payload.reviewId).toBe("rev-001");
      }
    });

    it("second code-review call (same handler instance) returns approved", async () => {
      const handler = createMockProcessHandler();
      await handler(baseOptions({ command: "codex", stdinData: "Review this PR's code" }));
      const second = await handler(baseOptions({ command: "codex", stdinData: "Review this PR's code" }));
      const parsed = extractStructuredOutput(second.stdout);
      expect(parsed.stage).toBe("reviewer");
      if (parsed.stage === "reviewer") {
        expect(parsed.payload.overallVerdict).toBe("approved");
        expect(parsed.payload.reviewId).toBe("rev-002");
      }
    });

    it("third and later code-review calls keep returning approved", async () => {
      const handler = createMockProcessHandler();
      await handler(baseOptions({ command: "codex", stdinData: "Review this PR's code" }));
      await handler(baseOptions({ command: "codex", stdinData: "Review this PR's code" }));
      const third = await handler(baseOptions({ command: "codex", stdinData: "Review this PR's code" }));
      const parsed = extractStructuredOutput(third.stdout);
      expect(parsed.stage).toBe("reviewer");
      if (parsed.stage === "reviewer") {
        expect(parsed.payload.overallVerdict).toBe("approved");
      }
    });

    it("code-review call counting is independent from plan-review calls", async () => {
      const handler = createMockProcessHandler();
      // A plan-review call should not consume a "code-review" call slot.
      await handler(baseOptions({ command: "codex", stdinData: "plan review" }));
      const result = await handler(baseOptions({ command: "codex", stdinData: "Review this PR's code" }));
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("reviewer");
      if (parsed.stage === "reviewer") {
        // Still the FIRST code-review call for this handler, so changes_requested.
        expect(parsed.payload.overallVerdict).toBe("changes_requested");
      }
    });

    it("call counters are scoped per handler instance, not shared globally", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();
      await handlerA(baseOptions({ command: "codex", stdinData: "Review this PR's code" }));
      const resultB = await handlerB(baseOptions({ command: "codex", stdinData: "Review this PR's code" }));
      const parsed = extractStructuredOutput(resultB.stdout);
      if (parsed.stage === "reviewer") {
        expect(parsed.payload.overallVerdict).toBe("changes_requested");
      }
    });

    it("matches a command ending with 'codex' (e.g. an absolute path)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "Review this PR's code" }),
      );
      const parsed = extractStructuredOutput(result.stdout);
      expect(parsed.stage).toBe("reviewer");
    });
  });

  describe("unknown command fallback", () => {
    it("returns a failed planner stub for an unrecognized command", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "some-other-cli", stdinData: "anything" }));
      const start = result.stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
      const end = result.stdout.indexOf(STRUCTURED_OUTPUT_END);
      const json = JSON.parse(result.stdout.slice(start + STRUCTURED_OUTPUT_BEGIN.length, end).trim());
      expect(json).toEqual({ success: false, stage: "planner", payload: {} });
      // This stub intentionally does not conform to PlannerOutputSchema (empty payload),
      // so it is not run through CliOutputSchema.parse here.
    });
  });
});
