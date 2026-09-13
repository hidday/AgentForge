import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
  PlannerOutputSchema,
  PlanReviewerOutputSchema,
  PlanReviserOutputSchema,
  AnswerResearcherOutputSchema,
  ExecutorOutputSchema,
  ReviewerOutputSchema,
  RemediationOutputSchema,
} from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function extractStructuredJson(stdout: string): unknown {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText);
}

function makeOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 60_000,
    stdinData: "",
    ...overrides,
  } as ProcessSpawnOptions;
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape for any recognized call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "claude", stdinData: "planner task" }));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  it("routes a claude call mentioning 'implementation plan' to a valid planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "please write an implementation plan" }),
    );

    const parsed = PlannerOutputSchema.parse(extractStructuredJson(result.stdout));
    expect(parsed.stage).toBe("planner");
    expect(parsed.payload.steps.length).toBeGreaterThan(0);
  });

  it("routes a claude call mentioning 'answer-researcher' to a valid answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "/usr/local/bin/claude", stdinData: "run as answer-researcher" }),
    );

    const parsed = AnswerResearcherOutputSchema.parse(extractStructuredJson(result.stdout));
    expect(parsed.stage).toBe("answer-researcher");
    expect(parsed.payload.answers.length).toBeGreaterThan(0);
  });

  it("routes a claude call mentioning 'lead engineer' to a valid plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "you are the lead engineer revising the plan" }),
    );

    const parsed = PlanReviserOutputSchema.parse(extractStructuredJson(result.stdout));
    expect(parsed.stage).toBe("plan-reviser");
    expect(parsed.payload.revisedPlan.planVersion).toBeGreaterThan(0);
  });

  it("routes a claude call mentioning 'remediat' to a valid remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "please remediate these findings" }),
    );

    const parsed = RemediationOutputSchema.parse(extractStructuredJson(result.stdout));
    expect(parsed.stage).toBe("remediation");
    expect(parsed.payload.resolution.length).toBeGreaterThan(0);
  });

  it("falls back to a valid executor output for an unrecognized claude prompt", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "claude", stdinData: "implement the feature now" }),
    );

    const parsed = ExecutorOutputSchema.parse(extractStructuredJson(result.stdout));
    expect(parsed.stage).toBe("executor");
    expect(parsed.payload.filesChanged.length).toBeGreaterThan(0);
  });

  it("routes a codex call mentioning 'plan under review' to a valid plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      makeOptions({ command: "codex", stdinData: "the plan under review is attached" }),
    );

    const parsed = PlanReviewerOutputSchema.parse(extractStructuredJson(result.stdout));
    expect(parsed.stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second, for the same handler instance", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(makeOptions({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(makeOptions({ command: "codex", stdinData: "review this diff" }));

    const firstParsed = ReviewerOutputSchema.parse(extractStructuredJson(first.stdout));
    const secondParsed = ReviewerOutputSchema.parse(extractStructuredJson(second.stdout));

    expect(firstParsed.payload.overallVerdict).toBe("changes_requested");
    expect(secondParsed.payload.overallVerdict).toBe("approved");
  });

  it("gives a fresh handler instance its own independent call-count state", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const aFirst = await handlerA(makeOptions({ command: "codex", stdinData: "review this diff" }));
    const bFirst = await handlerB(makeOptions({ command: "codex", stdinData: "review this diff" }));

    const aParsed = ReviewerOutputSchema.parse(extractStructuredJson(aFirst.stdout));
    const bParsed = ReviewerOutputSchema.parse(extractStructuredJson(bFirst.stdout));

    expect(aParsed.payload.overallVerdict).toBe("changes_requested");
    expect(bParsed.payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failure payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "cursor", stdinData: "anything" }));

    const parsed = extractStructuredJson(result.stdout) as { success: boolean; stage: string };
    expect(parsed.success).toBe(false);
    expect(parsed.stage).toBe("planner");
  });

  it("is case-insensitive when matching stdin content (uppercase 'PLANNER')", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "claude", stdinData: "PLANNER task" }));

    const parsed = PlannerOutputSchema.parse(extractStructuredJson(result.stdout));
    expect(parsed.stage).toBe("planner");
  });

  it("treats a command that exactly equals 'claude' as a claude call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "claude", stdinData: "" }));

    const parsed = ExecutorOutputSchema.parse(extractStructuredJson(result.stdout));
    expect(parsed.stage).toBe("executor");
  });

  it("treats a missing stdinData as empty content without throwing", async () => {
    const handler = createMockProcessHandler();
    const options = makeOptions({ command: "claude" });
    delete (options as { stdinData?: string }).stdinData;

    const result = await handler(options);

    expect(() => extractStructuredJson(result.stdout)).not.toThrow();
  });
});
