import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import {
  PlannerOutputSchema,
  PlanReviewerOutputSchema,
  PlanReviserOutputSchema,
  AnswerResearcherOutputSchema,
  ExecutorOutputSchema,
  ReviewerOutputSchema,
  RemediationOutputSchema,
} from "../../src/schemas/cliProtocol.js";
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

function extractStructuredJson(stdout: string): unknown {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  const jsonText = stdout.slice(begin + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  return JSON.parse(jsonText);
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape for every call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "planner" }));

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  describe("claude command routing", () => {
    it("returns the answer-researcher output when stdin mentions answer-researcher", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/bin/claude", stdinData: "Run the answer-researcher stage" }),
      );
      const json = extractStructuredJson(result.stdout);
      expect(AnswerResearcherOutputSchema.parse(json).stage).toBe("answer-researcher");
    });

    it("returns the answer-researcher output when stdin mentions 'open questions to research'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ stdinData: "Here are the OPEN QUESTIONS TO RESEARCH for this issue" }),
      );
      const json = extractStructuredJson(result.stdout);
      expect(AnswerResearcherOutputSchema.parse(json).stage).toBe("answer-researcher");
    });

    it("returns the plan-reviser output when stdin mentions 'plan revision'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Produce a plan revision" }));
      const json = extractStructuredJson(result.stdout);
      const parsed = PlanReviserOutputSchema.parse(json);
      expect(parsed.stage).toBe("plan-reviser");
      expect(parsed.payload.revision.reviewId).toBe("plan-rev-001");
    });

    it("returns the plan-reviser output when stdin mentions 'lead engineer'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "You are the lead engineer" }));
      const json = extractStructuredJson(result.stdout);
      expect(PlanReviserOutputSchema.parse(json).stage).toBe("plan-reviser");
    });

    it("returns the planner output when stdin mentions 'planner'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "You are the planner agent" }));
      const json = extractStructuredJson(result.stdout);
      expect(PlannerOutputSchema.parse(json).stage).toBe("planner");
    });

    it("returns the planner output when stdin mentions 'implementation plan'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ stdinData: "Produce an implementation plan for this issue" }),
      );
      const json = extractStructuredJson(result.stdout);
      expect(PlannerOutputSchema.parse(json).stage).toBe("planner");
    });

    it("returns the remediation output when stdin mentions 'remediat'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Begin remediation of findings" }));
      const json = extractStructuredJson(result.stdout);
      expect(RemediationOutputSchema.parse(json).stage).toBe("remediation");
    });

    it("falls back to the executor output for unrecognized claude stdin content", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "implement the feature" }));
      const json = extractStructuredJson(result.stdout);
      expect(ExecutorOutputSchema.parse(json).stage).toBe("executor");
    });

    it("matches a claude command given as a bare executable name", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "" }));
      const json = extractStructuredJson(result.stdout);
      expect(ExecutorOutputSchema.parse(json).stage).toBe("executor");
    });
  });

  describe("codex command routing", () => {
    it("returns the plan-reviewer output when stdin mentions 'plan review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "Perform a plan review of this plan" }),
      );
      const json = extractStructuredJson(result.stdout);
      expect(PlanReviewerOutputSchema.parse(json).stage).toBe("plan-reviewer");
    });

    it("returns the plan-reviewer output when stdin mentions 'plan under review'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "The plan under review is..." }),
      );
      const json = extractStructuredJson(result.stdout);
      expect(PlanReviewerOutputSchema.parse(json).stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second, for the same handler instance", async () => {
      const handler = createMockProcessHandler();
      const first = await handler(baseOptions({ command: "codex", stdinData: "review the code" }));
      const second = await handler(baseOptions({ command: "codex", stdinData: "review the code" }));

      const firstJson = ReviewerOutputSchema.parse(extractStructuredJson(first.stdout));
      const secondJson = ReviewerOutputSchema.parse(extractStructuredJson(second.stdout));

      expect(firstJson.payload.overallVerdict).toBe("changes_requested");
      expect(secondJson.payload.overallVerdict).toBe("approved");
    });

    it("keeps separate call counters for plan-review and code-review calls on the same handler", async () => {
      const handler = createMockProcessHandler();
      // A plan-reviewer call should not consume the code-review counter.
      await handler(baseOptions({ command: "codex", stdinData: "plan review" }));
      const codeReview = await handler(baseOptions({ command: "codex", stdinData: "review the code" }));
      const json = ReviewerOutputSchema.parse(extractStructuredJson(codeReview.stdout));
      expect(json.payload.overallVerdict).toBe("changes_requested");
    });
  });

  it("returns a failure envelope for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor-agent", stdinData: "anything" }));
    const json = extractStructuredJson(result.stdout) as { success: boolean; stage: string };
    expect(json.success).toBe(false);
    expect(json.stage).toBe("planner");
  });

  it("uses an independent call counter per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    await handlerA(baseOptions({ command: "codex", stdinData: "review the code" }));
    const firstOnB = await handlerB(baseOptions({ command: "codex", stdinData: "review the code" }));

    const json = ReviewerOutputSchema.parse(extractStructuredJson(firstOnB.stdout));
    expect(json.payload.overallVerdict).toBe("changes_requested");
  });
});
