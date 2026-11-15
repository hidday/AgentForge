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

function extractPayload(stdout: string): { stage: string; payload: unknown; success: boolean } {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN);
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  const json = stdout.slice(begin + STRUCTURED_OUTPUT_BEGIN.length, end).trim();
  return JSON.parse(json) as { stage: string; payload: unknown; success: boolean };
}

describe("createMockProcessHandler", () => {
  it("returns a ProcessResult shape with exitCode 0 and timedOut false", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions());

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("routes a claude call mentioning 'answer-researcher' to the answer-researcher payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "You are the answer-researcher agent." }),
    );
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("answer-researcher");
  });

  it("routes a claude call mentioning 'open questions to research' to the answer-researcher payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Here are the Open Questions To Research" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("answer-researcher");
  });

  it("routes a claude call mentioning 'plan-reviser' to the plan-reviser payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Acting as the plan-reviser" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes a claude call mentioning 'lead engineer' to the plan-reviser payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "You are acting as the Lead Engineer" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("plan-reviser");
  });

  it("routes a claude call mentioning 'planner' to the planner payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "You are the planner agent." }),
    );
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("planner");
    expect((parsed.payload as { planVersion: number }).planVersion).toBe(1);
  });

  it("routes a claude call mentioning 'implementation plan' to the planner payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Write an implementation plan for this." }),
    );
    expect(extractPayload(result.stdout).stage).toBe("planner");
  });

  it("routes a claude call mentioning 'remediat' to the remediation payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Perform remediation on these findings." }),
    );
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("remediation");
    expect((parsed.payload as { readyForHumanReview: boolean }).readyForHumanReview).toBe(true);
  });

  it("falls back to the executor payload for any other claude call", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Implement the feature." }),
    );
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("executor");
  });

  it("matches a claude command via an absolute path ending in 'claude'", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "" }),
    );
    expect(extractPayload(result.stdout).stage).toBe("executor");
  });

  it("routes a codex call mentioning 'plan review' to the plan-reviewer payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "Perform a plan review of the above." }),
    );
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("plan-reviewer");
  });

  it("routes a codex call mentioning 'plan under review' to the plan-reviewer payload", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "The plan under review is attached." }),
    );
    expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call, then approved on the second", async () => {
    const handler = createMockProcessHandler();

    const first = await handler(baseOptions({ command: "codex", stdinData: "Review this diff." }));
    const firstParsed = extractPayload(first.stdout);
    expect(firstParsed.stage).toBe("reviewer");
    expect((firstParsed.payload as { overallVerdict: string }).overallVerdict).toBe(
      "changes_requested",
    );

    const second = await handler(baseOptions({ command: "codex", stdinData: "Review this diff." }));
    const secondParsed = extractPayload(second.stdout);
    expect(secondParsed.stage).toBe("reviewer");
    expect((secondParsed.payload as { overallVerdict: string }).overallVerdict).toBe("approved");
  });

  it("tracks code-review call count independently per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const a1 = extractPayload((await handlerA(baseOptions({ command: "codex" }))).stdout);
    const b1 = extractPayload((await handlerB(baseOptions({ command: "codex" }))).stdout);

    expect((a1.payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
    expect((b1.payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
  });

  it("matches a codex command via an absolute path ending in 'codex'", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "/opt/bin/codex" }));
    const parsed = extractPayload(result.stdout);
    expect(parsed.stage).toBe("reviewer");
    expect((parsed.payload as { overallVerdict: string }).overallVerdict).toBe(
      "changes_requested",
    );
  });

  it("returns a failed planner payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor" }));
    const parsed = extractPayload(result.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.stage).toBe("planner");
    expect(parsed.payload).toEqual({});
  });

  it("treats a missing stdinData as an empty string without throwing", async () => {
    const handler = createMockProcessHandler();
    await expect(handler(baseOptions({ command: "claude", stdinData: undefined }))).resolves.toBeDefined();
  });
});
