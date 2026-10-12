import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { OutputParser } from "../../src/runtime/outputParser.js";
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

const parser = new OutputParser();

function baseOptions(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("createMockProcessHandler", () => {
  it("returns a ProcessResult shape with exitCode 0 and timedOut false", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "planner please" }));

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.stdout).toBe("string");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  describe("claude command routing", () => {
    it("routes 'answer-researcher' stdin to the answer-researcher mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "You are the answer-researcher" }),
      );
      const parsed = parser.parse(result.stdout, AnswerResearcherOutputSchema);
      expect(parsed.stage).toBe("answer-researcher");
      expect(parsed.payload.answers).toHaveLength(2);
    });

    it("routes 'open questions to research' stdin to the answer-researcher mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ stdinData: "Here are the Open Questions To Research" }),
      );
      const parsed = parser.parse(result.stdout, AnswerResearcherOutputSchema);
      expect(parsed.stage).toBe("answer-researcher");
    });

    it("routes 'plan revision' stdin to the plan-reviser mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Please produce a plan revision" }));
      const parsed = parser.parse(result.stdout, PlanReviserOutputSchema);
      expect(parsed.stage).toBe("plan-reviser");
      expect(parsed.payload.revisedPlan.planVersion).toBe(2);
      expect(parsed.payload.revision.dispositions.length).toBeGreaterThan(0);
    });

    it("routes 'lead engineer' stdin to the plan-reviser mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "You are the lead engineer" }));
      const parsed = parser.parse(result.stdout, PlanReviserOutputSchema);
      expect(parsed.stage).toBe("plan-reviser");
    });

    it("routes 'planner' stdin to the planner mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "You are the planner agent" }));
      const parsed = parser.parse(result.stdout, PlannerOutputSchema);
      expect(parsed.stage).toBe("planner");
      expect(parsed.payload.steps.length).toBeGreaterThan(0);
      expect(parsed.payload.confidence).toBeGreaterThan(0);
    });

    it("routes 'implementation plan' stdin to the planner mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Write an implementation plan" }));
      const parsed = parser.parse(result.stdout, PlannerOutputSchema);
      expect(parsed.stage).toBe("planner");
    });

    it("routes 'remediat' stdin to the remediation mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "Begin remediation of findings" }));
      const parsed = parser.parse(result.stdout, RemediationOutputSchema);
      expect(parsed.stage).toBe("remediation");
      expect(parsed.payload.resolution.length).toBeGreaterThan(0);
      expect(parsed.payload.executionReport.executionVersion).toBe(2);
    });

    it("falls back to the executor mock output for unmatched claude stdin", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ stdinData: "implement the feature please" }));
      const parsed = parser.parse(result.stdout, ExecutorOutputSchema);
      expect(parsed.stage).toBe("executor");
      expect(parsed.payload.filesChanged.length).toBeGreaterThan(0);
      expect(["pass", "fail"]).toContain(parsed.payload.checks.lint.status);
    });

    it("treats a command that merely ends with 'claude' as the claude binary", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/opt/homebrew/bin/claude", stdinData: "planner" }),
      );
      const parsed = parser.parse(result.stdout, PlannerOutputSchema);
      expect(parsed.stage).toBe("planner");
    });
  });

  describe("codex command routing", () => {
    it("routes 'plan review' stdin to the plan-reviewer mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "Conduct a plan review of the attached plan" }),
      );
      const parsed = parser.parse(result.stdout, PlanReviewerOutputSchema);
      expect(parsed.stage).toBe("plan-reviewer");
      expect(parsed.payload.overallVerdict).toBe("changes_requested");
    });

    it("routes 'plan-reviewer' stdin to the plan-reviewer mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "You are the plan-reviewer" }));
      const parsed = parser.parse(result.stdout, PlanReviewerOutputSchema);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("routes 'plan under review' stdin to the plan-reviewer mock output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "The plan under review is attached" }),
      );
      const parsed = parser.parse(result.stdout, PlanReviewerOutputSchema);
      expect(parsed.stage).toBe("plan-reviewer");
    });

    it("alternates code review verdicts: first call changes_requested, second call approved", async () => {
      const handler = createMockProcessHandler();
      const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const firstParsed = parser.parse(first.stdout, ReviewerOutputSchema);
      expect(firstParsed.stage).toBe("reviewer");
      expect(firstParsed.payload.overallVerdict).toBe("changes_requested");

      const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const secondParsed = parser.parse(second.stdout, ReviewerOutputSchema);
      expect(secondParsed.payload.overallVerdict).toBe("approved");

      // Third call stays approved (count only toggles once, via `<= 1`).
      const third = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
      const thirdParsed = parser.parse(third.stdout, ReviewerOutputSchema);
      expect(thirdParsed.payload.overallVerdict).toBe("approved");
    });

    it("tracks the code-review call count independently per handler instance", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();

      await handlerA(baseOptions({ command: "codex", stdinData: "review" }));
      // handlerA has now made one code-review call; handlerB is still fresh and
      // should start again at changes_requested, proving state isn't shared globally.
      const bFirst = await handlerB(baseOptions({ command: "codex", stdinData: "review" }));
      const parsed = parser.parse(bFirst.stdout, ReviewerOutputSchema);
      expect(parsed.payload.overallVerdict).toBe("changes_requested");
    });

    it("treats a command path ending in 'codex' as the codex binary", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan review" }),
      );
      const parsed = parser.parse(result.stdout, PlanReviewerOutputSchema);
      expect(parsed.stage).toBe("plan-reviewer");
    });
  });

  describe("unknown command", () => {
    it("returns a failure envelope for a command that is neither claude nor codex", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "cursor-agent", stdinData: "anything" }));
      const block = parser.extractStructuredBlock(result.stdout);
      const data = parser.parseJson(block) as { success: boolean; stage: string; payload: unknown };
      expect(data.success).toBe(false);
      expect(data.stage).toBe("planner");
      expect(data.payload).toEqual({});
    });
  });

  describe("missing stdinData", () => {
    it("treats an absent stdinData as an empty string without throwing", async () => {
      const handler = createMockProcessHandler();
      const options = baseOptions({ stdinData: undefined });
      delete (options as { stdinData?: string }).stdinData;
      const result = await handler(options);
      // No keyword matches -> falls through to the executor mock output.
      const parsed = parser.parse(result.stdout, ExecutorOutputSchema);
      expect(parsed.stage).toBe("executor");
    });
  });
});
