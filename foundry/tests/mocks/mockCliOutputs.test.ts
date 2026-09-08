import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
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

function extractPayload(stdout: string): { stage: string; payload: unknown } {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(begin, end).trim());
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "implementation plan" }));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  it("routes to the planner output for claude stdin mentioning 'planner'", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "You are the planner." }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("planner");
  });

  it("routes to the answer-researcher output when stdin mentions researching open questions", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "claude", stdinData: "Open Questions to Research" }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("answer-researcher");
  });

  it("routes to the plan-reviser output when stdin mentions plan revision", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "Plan revision needed" }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("plan-reviser");
  });

  it("routes to the remediation output when stdin mentions remediation", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "Please remediate this" }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("remediation");
  });

  it("falls back to the executor output for claude stdin matching nothing else", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "just implement it" }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("executor");
  });

  it("handles a missing stdinData for claude by falling back to the executor output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude" }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("executor");
  });

  it("recognizes claude invoked via an absolute path", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "/usr/local/bin/claude", stdinData: "implementation plan" }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("planner");
  });

  it("routes codex stdin mentioning plan review to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "codex", stdinData: "The plan under review is..." }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    const firstPayload = extractPayload(first.stdout) as {
      stage: string;
      payload: { overallVerdict: string };
    };
    expect(firstPayload.stage).toBe("reviewer");
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

    const second = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    const secondPayload = extractPayload(second.stdout) as {
      stage: string;
      payload: { overallVerdict: string };
    };
    expect(secondPayload.stage).toBe("reviewer");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
  });

  it("keeps independent code-review call counts per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const aFirst = extractPayload(
      (await handlerA(opts({ command: "codex", stdinData: "review" }))).stdout,
    ) as { payload: { overallVerdict: string } };
    const bFirst = extractPayload(
      (await handlerB(opts({ command: "codex", stdinData: "review" }))).stdout,
    ) as { payload: { overallVerdict: string } };

    expect(aFirst.payload.overallVerdict).toBe("changes_requested");
    expect(bFirst.payload.overallVerdict).toBe("changes_requested");
  });

  it("returns a failure payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "cursor", stdinData: "anything" }));
    const payload = extractPayload(result.stdout) as { success: boolean; stage: string };
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
  });

  it("matching is case-insensitive on stdinData", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "REMEDIATION needed" }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("remediation");
  });
});
