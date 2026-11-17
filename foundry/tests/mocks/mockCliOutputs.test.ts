import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end).trim());
}

function opts(command: string, stdinData?: string): ProcessSpawnOptions {
  return { command, args: [], cwd: "/tmp", timeoutMs: 1000, stdinData };
}

describe("createMockProcessHandler", () => {
  it("returns a well-shaped ProcessResult for a basic claude call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("claude", "do something"));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("routes a claude call mentioning the answer-researcher keyword to the researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts("/usr/local/bin/claude", "You are the answer-researcher agent."),
    );
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("answer-researcher");
  });

  it("routes a claude call mentioning 'open questions to research' (second OR operand) to the researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts("claude", "Here are the open questions to research for this plan."),
    );
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("answer-researcher");
  });

  it("routes a claude call mentioning 'plan revision' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts("claude", "Perform the plan revision based on review feedback."),
    );
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("plan-reviser");
  });

  it("routes a claude call mentioning only 'lead engineer' (third OR operand) to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("claude", "You are acting as the lead engineer on this task."));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("plan-reviser");
  });

  it("routes a claude call mentioning 'planner' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("claude", "You are the planner for this issue."));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("planner");
  });

  it("routes a claude call mentioning only 'implementation plan' (second OR operand) to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("claude", "Produce an implementation plan for this issue."));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("planner");
  });

  it("routes a claude call mentioning 'remediat' to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("claude", "Please remediate the findings from the review."));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("remediation");
  });

  it("falls back to the executor output for a claude call matching no keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("claude", "do the implementation work now"));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("executor");
  });

  it("defaults stdinContent to empty and still falls back to the executor output when stdinData is omitted", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("claude"));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("executor");
  });

  it("routes a codex call mentioning 'plan review' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("codex", "the plan review is ready"));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("plan-reviewer");
  });

  it("routes a codex call mentioning only 'plan-reviewer' (second OR operand) to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("codex", "acting as the plan-reviewer for this change"));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("plan-reviewer");
  });

  it("routes a codex call mentioning only 'plan under review' (third OR operand) to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("codex", "the plan under review has several steps"));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("plan-reviewer");
  });

  it("alternates code-review verdicts: first codex code-review call requests changes, second approves", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(opts("codex", "review this diff"));
    const firstParsed = extractPayload(first.stdout) as {
      stage: string;
      payload: { overallVerdict: string };
    };
    expect(firstParsed.stage).toBe("reviewer");
    expect(firstParsed.payload.overallVerdict).toBe("changes_requested");

    const second = await handler(opts("codex", "review this diff again"));
    const secondParsed = extractPayload(second.stdout) as {
      stage: string;
      payload: { overallVerdict: string };
    };
    expect(secondParsed.stage).toBe("reviewer");
    expect(secondParsed.payload.overallVerdict).toBe("approved");
  });

  it("keeps call-count state independent between separate handler instances", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const aFirst = extractPayload(
      (await handlerA(opts("codex", "review this diff"))).stdout,
    ) as { payload: { overallVerdict: string } };
    const bFirst = extractPayload(
      (await handlerB(opts("codex", "review this diff"))).stdout,
    ) as { payload: { overallVerdict: string } };

    expect(aFirst.payload.overallVerdict).toBe("changes_requested");
    expect(bFirst.payload.overallVerdict).toBe("changes_requested");
  });

  it("falls back to a failure planner payload when the command is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("/usr/bin/python3", "anything"));
    const parsed = extractPayload(result.stdout);
    expect(parsed).toEqual({ success: false, stage: "planner", payload: {} });
  });

  it("recognizes a command that merely ends with 'claude' (not an exact match)", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts("/opt/bin/claude", "remediate this"));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("remediation");
  });
});
