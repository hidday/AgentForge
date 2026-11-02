import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const begin = stdout.lastIndexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END, begin);
  return JSON.parse(stdout.slice(begin, end).trim());
}

describe("createMockProcessHandler", () => {
  it("routes a claude answer-researcher prompt to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "You are the answer-researcher. Open questions to research: ...",
    });
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("routes a claude plan-reviser prompt to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "/usr/local/bin/claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "You are the lead engineer doing a plan revision.",
    });
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes a claude planner prompt to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "You are the planner. Produce an implementation plan.",
    });
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes a claude remediation prompt to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please remediate the findings below.",
    });
    expect(extractPayload(result.stdout).stage).toBe("remediation");
  });

  it("falls back to the executor output for any other claude prompt", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Implement the approved plan.",
    });
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("routes a codex plan-review prompt to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "You are the plan-reviewer. The plan under review is below.",
    });
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();
    const first = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Review this diff.",
    });
    const second = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Review this diff.",
    });

    const firstPayload = extractPayload(first.stdout).payload as { overallVerdict: string };
    const secondPayload = extractPayload(second.stdout).payload as { overallVerdict: string };
    expect(firstPayload.overallVerdict).toBe("changes_requested");
    expect(secondPayload.overallVerdict).toBe("approved");
  });

  it("keeps independent call counters for plan-review vs code-review on the same codex handler", async () => {
    const handler = createMockProcessHandler();
    // A plan-review call should not consume a code-review call slot.
    await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "plan under review",
    });
    const codeReview = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Review this diff.",
    });
    const payload = extractPayload(codeReview.stdout).payload as { overallVerdict: string };
    expect(payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failed planner stub for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "agent",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "anything",
    });
    const parsed = extractPayload(result.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.stage).toBe("planner");
  });

  it("treats a missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 });
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("resolves with a plausible durationMs", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({ command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000 });
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });
});
