import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function opts(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function parsePayload(stdout: string): { stage: string; payload: unknown } {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  return JSON.parse(stdout.slice(start, end + 1));
}

describe("createMockProcessHandler", () => {
  it("returns a successful, non-timed-out ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ stdinData: "planner prompt" }));
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });

  it("routes a claude command mentioning 'planner' to the planner payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ stdinData: "You are the planner. Produce an implementation plan." }));
    const { stage } = parsePayload(result.stdout);
    expect(stage).toBe("planner");
  });

  it("routes a claude command mentioning 'answer-researcher' to the answer-researcher payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ stdinData: "answer-researcher: here are the open questions to research" }),
    );
    const { stage } = parsePayload(result.stdout);
    expect(stage).toBe("answer-researcher");
  });

  it("routes a claude command mentioning 'lead engineer' plan revision to the plan-reviser payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ stdinData: "You are the lead engineer handling plan revision" }),
    );
    const { stage } = parsePayload(result.stdout);
    expect(stage).toBe("plan-reviser");
  });

  it("routes a claude command mentioning 'remediat' to the remediation payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ stdinData: "Please remediate the review findings" }));
    const { stage } = parsePayload(result.stdout);
    expect(stage).toBe("remediation");
  });

  it("falls back to the executor payload for a claude command matching no other keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ stdinData: "implement the plan" }));
    const { stage } = parsePayload(result.stdout);
    expect(stage).toBe("executor");
  });

  it("routes a codex command mentioning plan review to the plan-reviewer payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "codex", stdinData: "the plan under review is attached" }),
    );
    const { stage } = parsePayload(result.stdout);
    expect(stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call, then approved on the second", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(opts({ command: "codex", stdinData: "review this diff" }));

    const firstPayload = parsePayload(first.stdout).payload as { overallVerdict: string };
    const secondPayload = parsePayload(second.stdout).payload as { overallVerdict: string };
    expect(firstPayload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.overallVerdict).toBe("approved");
  });

  it("keeps plan-reviewer and code-review call counters independent across repeated calls", async () => {
    const handler = createMockProcessHandler();
    await handler(opts({ command: "codex", stdinData: "plan-reviewer: review the plan" }));
    const codeReview = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    const payload = parsePayload(codeReview.stdout).payload as { overallVerdict: string };
    expect(payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failure payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "agent", stdinData: "anything" }));
    const parsed = parsePayload(result.stdout) as { success: boolean; stage: string };
    expect(parsed.success).toBe(false);
    expect(parsed.stage).toBe("planner");
  });
});
