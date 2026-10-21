import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function opts(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("createMockProcessHandler", () => {
  it("returns a resolved ProcessResult with exitCode 0 and no stderr", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts());
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });

  it.each(["answer-researcher requested", "please list open questions to research"])(
    "dispatches claude + %s to the answer-researcher mock output",
    async (stdin) => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: stdin }));
      expect(result.stdout).toContain('"stage": "answer-researcher"');
    },
  );

  it.each([
    "plan revision requested",
    "acting as plan-reviser",
    "you are the lead engineer reviewing this",
  ])("dispatches claude + %s to the plan-reviser mock output", async (stdin) => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: stdin }));
    expect(result.stdout).toContain('"stage": "plan-reviser"');
  });

  it.each(["acting as planner", "write an implementation plan"])(
    "dispatches claude + %s to the planner mock output",
    async (stdin) => {
      const handler = createMockProcessHandler();
      const result = await handler(opts({ command: "claude", stdinData: stdin }));
      expect(result.stdout).toContain('"stage": "planner"');
    },
  );

  it("dispatches claude + 'remediat*' stdin to the remediation mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "please remediate this failure" }));
    expect(result.stdout).toContain('"stage": "remediation"');
  });

  it("falls back to the executor mock output for claude with no recognized keyword", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "claude", stdinData: "implement the feature" }));
    expect(result.stdout).toContain('"stage": "executor"');
  });

  it("matches claude by a command path ending in /claude, not just the literal name", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "/usr/local/bin/claude", stdinData: "" }));
    expect(result.stdout).toContain('"stage": "executor"');
  });

  it("dispatches codex + plan-review stdin to the plan-reviewer mock output", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(
      opts({ command: "codex", stdinData: "the plan under review is attached" }),
    );
    expect(result.stdout).toContain('"stage": "plan-reviewer"');
  });

  it("alternates codex code-review calls: first changes_requested, then approved", async () => {
    const handler = createMockProcessHandler();
    const first = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    const second = await handler(opts({ command: "codex", stdinData: "review this diff" }));
    expect(first.stdout).toContain("rev-001");
    expect(second.stdout).toContain("rev-002");
    expect(first.stdout).not.toEqual(second.stdout);
  });

  it("matches codex by a command path ending in /codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "/usr/local/bin/codex", stdinData: "review this" }));
    expect(result.stdout).toContain("rev-001");
  });

  it("returns a failed planner stage payload for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(opts({ command: "unknown-tool", stdinData: "" }));
    expect(result.stdout).toContain('"success": false');
    expect(result.stdout).toContain('"stage": "planner"');
  });

  it("keeps independent call counters per handler instance", async () => {
    const handlerA = createMockProcessHandler();
    const handlerB = createMockProcessHandler();
    const firstA = await handlerA(opts({ command: "codex", stdinData: "review" }));
    const firstB = await handlerB(opts({ command: "codex", stdinData: "review" }));
    // Both are each handler's first call, so both land on the same alternation branch.
    expect(firstA.stdout).toContain("rev-001");
    expect(firstB.stdout).toContain("rev-001");
  });
});
