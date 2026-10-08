import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";

function makeOptions(overrides: Partial<ProcessSpawnOptions> = {}): ProcessSpawnOptions {
  return { command: "claude", args: [], cwd: "/tmp", timeoutMs: 1000, ...overrides };
}

function parseStage(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const start = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END);
  return JSON.parse(stdout.slice(start, end).trim());
}

describe("createMockProcessHandler", () => {
  it("returns a resolved ProcessResult with exitCode 0 and no timeout", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions());

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
  });

  describe("claude routing (by stdin content)", () => {
    it("routes an answer-researcher prompt to the answer-researcher payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "claude", stdinData: "You are the answer-researcher. Open questions to research:" }),
      );
      expect(parseStage(result.stdout).stage).toBe("answer-researcher");
    });

    it("routes a plan-revision prompt to the plan-reviser payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "claude", stdinData: "This is a plan revision task" }));
      expect(parseStage(result.stdout).stage).toBe("plan-reviser");
    });

    it("routes a planner prompt to the planner payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/local/bin/claude", stdinData: "Create an implementation plan" }),
      );
      expect(parseStage(result.stdout).stage).toBe("planner");
    });

    it("routes a remediation prompt to the remediation payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "claude", stdinData: "Please remediate the findings" }));
      expect(parseStage(result.stdout).stage).toBe("remediation");
    });

    it("defaults to the executor payload when stdin matches no other claude stage", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "claude", stdinData: "Implement the plan" }));
      expect(parseStage(result.stdout).stage).toBe("executor");
    });

    it("defaults to the executor payload when stdinData is absent", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "claude" }));
      expect(parseStage(result.stdout).stage).toBe("executor");
    });
  });

  describe("codex routing (by stdin content and call count)", () => {
    it("routes a plan-review prompt to the plan-reviewer payload", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "codex", stdinData: "Plan under review" }));
      expect(parseStage(result.stdout).stage).toBe("plan-reviewer");
    });

    it("returns a changes_requested code review verdict on the first call", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));
      const parsed = parseStage(result.stdout).payload as { overallVerdict: string };
      expect(parsed.overallVerdict).toBe("changes_requested");
    });

    it("returns an approved code review verdict on the second call", async () => {
      const handler = createMockProcessHandler();
      await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));
      const second = await handler(makeOptions({ command: "codex", stdinData: "Review this diff" }));
      const parsed = parseStage(second.stdout).payload as { overallVerdict: string };
      expect(parsed.overallVerdict).toBe("approved");
    });

    it("tracks code-review call count independently per handler instance", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();
      await handlerA(makeOptions({ command: "codex", stdinData: "Review this diff" }));

      const resultB = await handlerB(makeOptions({ command: "codex", stdinData: "Review this diff" }));

      expect((parseStage(resultB.stdout).payload as { overallVerdict: string }).overallVerdict).toBe(
        "changes_requested",
      );
    });

    it("matches codex by a command path ending in 'codex'", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        makeOptions({ command: "/usr/local/bin/codex", stdinData: "Plan under review" }),
      );
      expect(parseStage(result.stdout).stage).toBe("plan-reviewer");
    });
  });

  it("returns a failure payload for an unrecognized command", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(makeOptions({ command: "cursor" }));
    const parsed = parseStage(result.stdout);
    expect(parsed).toEqual({ success: false, stage: "planner", payload: {} });
  });
});
