import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

function extractPayload(stdout: string): { stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end).trim());
}

describe("createMockProcessHandler", () => {
  it("routes answer-researcher stdin to the answer-researcher mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please research these open questions to research for the plan.",
    });
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes plan-revision stdin to the plan-reviser mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "You are the lead engineer revising the plan after review.",
    });
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes planner stdin to the planner mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Produce an implementation plan for this issue.",
    });
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes remediation stdin to the remediation mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please remediate the findings from the review.",
    });
    expect(extractPayload(result.stdout).stage).toBe("remediation");
  });

  it("falls back to the executor mock output for unrecognized claude stdin", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Just implement the change.",
    });
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("matches claude invoked by exact command name without a path", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({ command: "claude", args: [], cwd: "/tmp" });
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("routes codex stdin containing 'plan review' to the plan-reviewer mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please perform a plan review of this plan under review.",
    });
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("alternates codex code-review responses: changes_requested first, approved second", async () => {
    const handler = createMockProcessHandler();
    const first = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please review this diff.",
    });
    const second = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please review this diff.",
    });
    const firstPayload = extractPayload(first.stdout).payload as { overallVerdict: string };
    const secondPayload = extractPayload(second.stdout).payload as { overallVerdict: string };
    expect(firstPayload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.overallVerdict).toBe("approved");
  });

  it("matches codex invoked by exact command name without a path, defaulting to code review", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({ command: "codex", args: [], cwd: "/tmp", timeoutMs: 1000 });
    expect(extractPayload(result.stdout).stage).toBe("reviewer");
  });

  it("returns a failure envelope for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({ command: "some-other-cli", args: [], cwd: "/tmp" });
    const payload = extractPayload(result.stdout) as { success: boolean };
    expect(payload.success).toBe(false);
  });

  it("always resolves with exitCode 0 and timedOut false", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({ command: "claude", args: [], cwd: "/tmp" });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });

  it("keeps independent call counters across two separately-created handlers", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();
    const aFirst = await handlerA({ command: "codex", args: [], cwd: "/tmp",
      timeoutMs: 1000, stdinData: "review" });
    const bFirst = await handlerB({ command: "codex", args: [], cwd: "/tmp",
      timeoutMs: 1000, stdinData: "review" });
    const aPayload = extractPayload(aFirst.stdout).payload as { overallVerdict: string };
    const bPayload = extractPayload(bFirst.stdout).payload as { overallVerdict: string };
    expect(aPayload.overallVerdict).toBe("changes_requested");
    expect(bPayload.overallVerdict).toBe("changes_requested");
  });
});
