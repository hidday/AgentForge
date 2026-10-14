import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end).trim());
}

describe("createMockProcessHandler", () => {
  it("routes a claude call mentioning 'answer-researcher' to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "You are the answer-researcher agent.",
    });
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("answer-researcher");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("routes a claude call mentioning 'open questions to research' to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "/usr/local/bin/claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Here are the open questions to research for this run.",
    });
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes a claude call mentioning plan revision to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "You are the lead engineer doing a plan revision.",
    });
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes a claude call mentioning 'planner' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "You are the planner agent. Produce an implementation plan.",
    });
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes a claude call mentioning 'remediat' to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please remediate the review findings below.",
    });
    expect(extractPayload(result.stdout).stage).toBe("remediation");
  });

  it("falls back to the executor output for an unrecognized claude prompt", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "do the implementation work",
    });
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("routes a codex call mentioning plan review to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "The plan under review needs a second opinion.",
    });
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("returns 'changes_requested' on the first codex code-review call and 'approved' on the second", async () => {
    const handler = createMockProcessHandler();
    const input = {
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please review this implementation.",
    };

    const first = await handler(input);
    const firstPayload = extractPayload(first.stdout).payload as { overallVerdict: string };
    expect(firstPayload.overallVerdict).toBe("changes_requested");

    const second = await handler(input);
    const secondPayload = extractPayload(second.stdout).payload as { overallVerdict: string };
    expect(secondPayload.overallVerdict).toBe("approved");
  });

  it("tracks plan-review and code-review call counts independently per handler instance", async () => {
    const handler = createMockProcessHandler();
    // A plan-review call first should not consume the code-review counter.
    await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "plan-reviewer: plan under review",
    });

    const result = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please review this implementation.",
    });
    // Still the first code-review call for this handler instance.
    const payload = extractPayload(result.stdout).payload as { overallVerdict: string };
    expect(payload.overallVerdict).toBe("changes_requested");
  });

  it("gives a fresh call counter to a new handler instance", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "Please review this implementation.",
    });
    const payload = extractPayload(result.stdout).payload as { overallVerdict: string };
    expect(payload.overallVerdict).toBe("changes_requested");
  });

  it("recognizes a bare 'codex' command (no path prefix)", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "codex",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "review please",
    });
    expect(result.exitCode).toBe(0);
  });

  it("falls back to a failed planner envelope for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "cursor",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
      stdinData: "anything",
    });
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("planner");
    expect(parsed.success).toBe(false);
  });

  it("treats missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler({
      command: "claude",
      args: [],
      cwd: "/tmp",
      timeoutMs: 1000,
    });
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });
});
