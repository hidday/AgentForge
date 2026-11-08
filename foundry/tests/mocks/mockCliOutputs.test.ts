import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/workspace",
    timeoutMs: 60000,
    ...overrides,
  };
}

function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const match = stdout.match(/BEGIN_STRUCTURED_OUTPUT\n([\s\S]*?)\nEND_STRUCTURED_OUTPUT/);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]) as { success: boolean; stage: string; payload: unknown };
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions());
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(typeof result.stdout).toBe("string");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("routes a claude command mentioning answer-researcher to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "You are the answer-researcher agent." }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("answer-researcher");
  });

  it("routes a claude command mentioning 'open questions to research' to the answer-researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "Here are the Open Questions To Research for this plan." }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("answer-researcher");
  });

  it("routes a claude command mentioning 'plan revision' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Please produce a plan revision." }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("plan-reviser");
  });

  it("routes a claude command mentioning 'plan-reviser' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are the plan-reviser." }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("plan-reviser");
  });

  it("routes a claude command mentioning 'lead engineer' to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "You are acting as the lead engineer revising this plan." }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("plan-reviser");
  });

  it("routes a claude command mentioning 'planner' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "You are the planner agent." }));
    const { stage, payload } = extractPayload(result.stdout);
    expect(stage).toBe("planner");
    expect((payload as { planVersion: number }).planVersion).toBe(1);
  });

  it("routes a claude command mentioning 'implementation plan' to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "Write an implementation plan for this issue." }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("planner");
  });

  it("routes a claude command mentioning 'remediat' to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ stdinData: "Perform remediation on the reviewed findings." }),
    );
    const { stage, payload } = extractPayload(result.stdout);
    expect(stage).toBe("remediation");
    expect((payload as { readyForHumanReview: boolean }).readyForHumanReview).toBe(true);
  });

  it("falls back to the executor output for a claude command matching no other keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: "Just implement the feature please." }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("executor");
  });

  it("falls back to the executor output when stdinData is undefined", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ stdinData: undefined }));
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("executor");
  });

  it("recognizes claude via an absolute path ending in /claude", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner" }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("planner");
  });

  it("routes a codex command mentioning 'plan review' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "Conduct a plan review of this proposal." }),
    );
    const { stage, payload } = extractPayload(result.stdout);
    expect(stage).toBe("plan-reviewer");
    expect((payload as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
  });

  it("routes a codex command mentioning 'plan-reviewer' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "You are the plan-reviewer." }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("plan-reviewer");
  });

  it("routes a codex command mentioning 'plan under review' to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "The plan under review is attached." }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("plan-reviewer");
  });

  it("recognizes codex via an absolute path ending in /codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/opt/bin/codex", stdinData: "plan review" }),
    );
    const { stage } = extractPayload(result.stdout);
    expect(stage).toBe("plan-reviewer");
  });

  it("returns changes_requested on the first codex code-review call, then approved on the second, within one handler instance", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(
      baseOptions({ command: "codex", stdinData: "Please review this code change." }),
    );
    const second = await handler(
      baseOptions({ command: "codex", stdinData: "Please review this code change." }),
    );
    const firstPayload = extractPayload(first.stdout);
    const secondPayload = extractPayload(second.stdout);
    expect((firstPayload.payload as { overallVerdict: string }).overallVerdict).toBe(
      "changes_requested",
    );
    expect((secondPayload.payload as { overallVerdict: string }).overallVerdict).toBe("approved");
  });

  it("tracks codex call counts independently per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();
    const aFirst = await handlerA(baseOptions({ command: "codex", stdinData: "review" }));
    const bFirst = await handlerB(baseOptions({ command: "codex", stdinData: "review" }));
    expect(
      (extractPayload(aFirst.stdout).payload as { overallVerdict: string }).overallVerdict,
    ).toBe("changes_requested");
    expect(
      (extractPayload(bFirst.stdout).payload as { overallVerdict: string }).overallVerdict,
    ).toBe("changes_requested");
  });

  it("returns a failure payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor-agent" }));
    const { success, stage, payload } = extractPayload(result.stdout);
    expect(success).toBe(false);
    expect(stage).toBe("planner");
    expect(payload).toEqual({});
  });
});
