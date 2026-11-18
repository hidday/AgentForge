import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import {
  STRUCTURED_OUTPUT_BEGIN,
  STRUCTURED_OUTPUT_END,
} from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

function extractPayload(stdout: string): { stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  const json = stdout.slice(start, end).trim();
  return JSON.parse(json) as { stage: string; payload: unknown };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
  });

  it("routes a claude call mentioning 'answer-researcher' to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "This is for the answer-researcher stage" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes a claude call mentioning 'open questions to research' to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "Here are the Open Questions To Research for this plan" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes a claude call mentioning 'plan-reviser' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are the plan-reviser" }));
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes a claude call mentioning 'lead engineer' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are a Lead Engineer revising the plan" }));
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes a claude call mentioning 'planner' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are the planner agent" }));
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes a claude call mentioning 'implementation plan' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Produce an implementation plan" }));
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes a claude call mentioning 'remediat' to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Please remediate the review findings" }));
    expect(extractPayload(result.stdout).stage).toBe("remediation");
  });

  it("falls back to the executor output for a claude call matching no other keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Just implement the plan" }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("recognizes the claude command by exact match too", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: undefined }));
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("routes a codex call mentioning 'plan review' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/bin/codex", stdinData: "Perform a plan review of the following" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("routes a codex call mentioning 'plan under review' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "codex", stdinData: "The plan under review is..." }));
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(baseOptions({ command: "codex", stdinData: "Review this diff" }));
    const firstPayload = extractPayload(first.stdout) as { stage: string; payload: { overallVerdict: string } };
    expect(firstPayload.stage).toBe("reviewer");
    expect(firstPayload.payload.overallVerdict).toBe("changes_requested");

    const second = await handler(baseOptions({ command: "codex", stdinData: "Review this diff" }));
    const secondPayload = extractPayload(second.stdout) as { stage: string; payload: { overallVerdict: string } };
    expect(secondPayload.stage).toBe("reviewer");
    expect(secondPayload.payload.overallVerdict).toBe("approved");
  });

  it("tracks code-review call counts independently per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const firstA = await handlerA(baseOptions({ command: "codex", stdinData: "Review this diff" }));
    const firstB = await handlerB(baseOptions({ command: "codex", stdinData: "Review this diff" }));

    expect((extractPayload(firstA.stdout).payload as { overallVerdict: string }).overallVerdict).toBe(
      "changes_requested",
    );
    expect((extractPayload(firstB.stdout).payload as { overallVerdict: string }).overallVerdict).toBe(
      "changes_requested",
    );
  });

  it("returns a failure payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor-agent", stdinData: "anything" }));

    const payload = extractPayload(result.stdout) as { success: boolean; stage: string; payload: unknown };
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
    expect(payload.payload).toEqual({});
  });

  it("treats a missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: undefined }));
    expect(() => extractPayload(result.stdout)).not.toThrow();
  });
});
