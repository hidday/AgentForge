import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    stdinData: "",
    ...overrides,
  };
}

function extractStage(stdout: string): string {
  const match = /"stage":\s*"([^"]+)"/.exec(stdout);
  if (!match) throw new Error(`no stage found in stdout: ${stdout}`);
  return match[1]!;
}

describe("createMockProcessHandler", () => {
  it("routes a claude command whose stdin mentions the answer-researcher to the researcher output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "This is an answer-researcher task." }),
    );
    expect(extractStage(result.stdout)).toBe("answer-researcher");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  it("routes a claude command whose stdin mentions plan revision to the plan-reviser output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Please perform a plan revision now." }),
    );
    expect(extractStage(result.stdout)).toBe("plan-reviser");
  });

  it("routes a claude command whose stdin mentions the planner to the planner output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "You are the implementation plan author." }),
    );
    expect(extractStage(result.stdout)).toBe("planner");
  });

  it("routes a claude command whose stdin mentions remediation to the remediation output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Time to remediate the findings." }),
    );
    expect(extractStage(result.stdout)).toBe("remediation");
  });

  it("falls back to the executor output for a claude command whose stdin matches no known keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "claude", stdinData: "Just implement the feature please." }),
    );
    expect(extractStage(result.stdout)).toBe("executor");
  });

  it("matches a full path ending in 'claude' as a claude command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/claude", stdinData: "planner task" }),
    );
    expect(extractStage(result.stdout)).toBe("planner");
  });

  it("routes a codex command whose stdin mentions plan review to the plan-reviewer output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "codex", stdinData: "This plan under review needs a look." }),
    );
    expect(extractStage(result.stdout)).toBe("plan-reviewer");
  });

  it("returns a changes_requested review on the first codex code-review call and approved on the second", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(baseOptions({ command: "codex", stdinData: "review this diff" }));

    expect(extractStage(first.stdout)).toBe("reviewer");
    expect(extractStage(second.stdout)).toBe("reviewer");
    expect(first.stdout).toContain("changes_requested");
    expect(second.stdout).not.toContain("changes_requested");
  });

  it("tracks codex call counts independently per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();

    const aFirst = await handlerA(baseOptions({ command: "codex", stdinData: "review this diff" }));
    // A fresh handler's counter starts over, so its first call is also changes_requested.
    const bFirst = await handlerB(baseOptions({ command: "codex", stdinData: "review this diff" }));

    expect(aFirst.stdout).toContain("changes_requested");
    expect(bFirst.stdout).toContain("changes_requested");
  });

  it("matches a full path ending in 'codex' as a codex command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      baseOptions({ command: "/usr/local/bin/codex", stdinData: "plan-reviewer check" }),
    );
    expect(extractStage(result.stdout)).toBe("plan-reviewer");
  });

  it("returns a failed planner payload for a command that is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor", stdinData: "anything" }));

    expect(result.stdout).toContain('"success": false');
    expect(extractStage(result.stdout)).toBe("planner");
  });

  it("treats a missing stdinData as empty input without throwing", async () => {
    const handler = createMockProcessHandler();
    const options = baseOptions({ command: "claude" });
    delete (options as { stdinData?: string }).stdinData;
    const result = await handler(options);
    expect(extractStage(result.stdout)).toBe("executor");
  });

  it("reports a plausible durationMs in the simulated range", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "planner" }));
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
  });
});
