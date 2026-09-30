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

function extractPayload(stdout: string): unknown {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const jsonText = stdout.slice(start, end).trim();
  return JSON.parse(jsonText);
}

function opts(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ stdinData: "You are the planner. implementation plan" }));
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  it("routes claude + planner-shaped stdin to a valid PlannerOutput payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "Please act as the planner and produce an implementation plan" }),
    );
    const payload = extractPayload(result.stdout);
    const parsed = PlannerOutputSchema.parse(payload);
    expect(parsed.stage).toBe("planner");
    expect(parsed.payload.steps.length).toBeGreaterThan(0);
  });

  it("routes claude + answer-researcher stdin to a valid AnswerResearcherOutput payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "answer-researcher: open questions to research" }),
    );
    const payload = extractPayload(result.stdout);
    const parsed = AnswerResearcherOutputSchema.parse(payload);
    expect(parsed.stage).toBe("answer-researcher");
  });

  it("routes claude + plan-revision-shaped stdin to a valid PlanReviserOutput payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "You are the lead engineer doing a plan revision" }),
    );
    const payload = extractPayload(result.stdout);
    const parsed = PlanReviserOutputSchema.parse(payload);
    expect(parsed.stage).toBe("plan-reviser");
    expect(parsed.payload.revisedPlan.planVersion).toBe(2);
  });

  it("routes claude + remediation stdin to a valid RemediationOutput payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "please run remediation now" }));
    const payload = extractPayload(result.stdout);
    const parsed = RemediationOutputSchema.parse(payload);
    expect(parsed.stage).toBe("remediation");
    expect(parsed.payload.executionReport.executionVersion).toBe(2);
  });

  it("routes claude with unrecognized stdin to a valid ExecutorOutput payload (default branch)", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "just build the feature" }));
    const payload = extractPayload(result.stdout);
    const parsed = ExecutorOutputSchema.parse(payload);
    expect(parsed.stage).toBe("executor");
  });

  it("routes codex + plan-review stdin to a valid PlanReviewerOutput payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "codex", stdinData: "the plan under review is attached" }),
    );
    const payload = extractPayload(result.stdout);
    const parsed = PlanReviewerOutputSchema.parse(payload);
    expect(parsed.stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(opts({ command: "codex", stdinData: "please review this diff" }));
    const firstPayload = extractPayload(first.stdout);
    const firstParsed = ReviewerOutputSchema.parse(firstPayload);
    expect(firstParsed.payload.overallVerdict).toBe("changes_requested");

    const second = await handler(opts({ command: "codex", stdinData: "please review this diff" }));
    const secondPayload = extractPayload(second.stdout);
    const secondParsed = ReviewerOutputSchema.parse(secondPayload);
    expect(secondParsed.payload.overallVerdict).toBe("approved");
  });

  it("keeps independent call counters per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const aFirst = extractPayload(
      (await handlerA(opts({ command: "codex", stdinData: "review" }))).stdout,
    );
    const bFirst = extractPayload(
      (await handlerB(opts({ command: "codex", stdinData: "review" }))).stdout,
    );

    expect(ReviewerOutputSchema.parse(aFirst).payload.overallVerdict).toBe("changes_requested");
    expect(ReviewerOutputSchema.parse(bFirst).payload.overallVerdict).toBe("changes_requested");
  });

  it("falls back to a failure payload when the command is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "some-other-cli", stdinData: "anything" }));
    const payload = extractPayload(result.stdout) as { success: boolean; stage: string };
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
  });

  it("matches commands by suffix (e.g. an absolute path ending in /claude or /codex)", async () => {
    const handler = createMockProcessHandler();
    const claudeResult = await handler(
      opts({ command: "/usr/local/bin/claude", stdinData: "implementation plan for planner" }),
    );
    const claudePayload = extractPayload(claudeResult.stdout) as { stage: string };
    expect(claudePayload.stage).toBe("planner");

    const codexResult = await handler(
      opts({ command: "/usr/local/bin/codex", stdinData: "review this" }),
    );
    const codexPayload = extractPayload(codexResult.stdout) as { stage: string };
    expect(codexPayload.stage).toBe("reviewer");
  });

  it("treats missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    await expect(handler(opts({ command: "claude", stdinData: undefined }))).resolves.toBeDefined();
  });
});
