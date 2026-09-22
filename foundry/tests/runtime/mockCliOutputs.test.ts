import { describe, it, expect } from "vitest";
import { createMockProcessHandler } from "../../src/mocks/mockCliOutputs.js";
import type { ProcessSpawnOptions } from "../../src/runtime/runnerTypes.js";
import { STRUCTURED_OUTPUT_BEGIN, STRUCTURED_OUTPUT_END } from "../../src/schemas/cliProtocol.js";

function baseOptions(overrides: Partial<ProcessSpawnOptions>): ProcessSpawnOptions {
  return {
    command: "claude",
    args: [],
    cwd: "/tmp",
    timeoutMs: 1000,
    ...overrides,
  };
}

/** Pulls the JSON payload out of a `wrap()`-formatted mock stdout string. */
function extractPayload(stdout: string): { success: boolean; stage: string; payload: unknown } {
  const begin = stdout.indexOf(STRUCTURED_OUTPUT_BEGIN) + STRUCTURED_OUTPUT_BEGIN.length;
  const end = stdout.indexOf(STRUCTURED_OUTPUT_END, begin);
  return JSON.parse(stdout.slice(begin, end).trim());
}

describe("createMockProcessHandler", () => {
  it("returns a well-formed ProcessResult shape regardless of branch taken", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "claude", stdinData: "planner task" }));

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.durationMs).toBeLessThan(2000);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_BEGIN);
    expect(result.stdout).toContain(STRUCTURED_OUTPUT_END);
    expect(result.stdout).toContain("Analyzing the task...");
  });

  describe("claude-command branches (isClaude)", () => {
    const cases: Array<{ stdin: string; expectedStage: string; label: string }> = [
      { stdin: "please act as the answer-researcher", expectedStage: "answer-researcher", label: "answer-researcher keyword" },
      { stdin: "here are the open questions to research", expectedStage: "answer-researcher", label: "open questions to research phrase" },
      { stdin: "this is a plan revision request", expectedStage: "plan-reviser", label: "plan revision phrase" },
      { stdin: "you are the plan-reviser", expectedStage: "plan-reviser", label: "plan-reviser keyword" },
      { stdin: "acting as lead engineer, revise the plan", expectedStage: "plan-reviser", label: "lead engineer phrase" },
      { stdin: "you are the planner for this issue", expectedStage: "planner", label: "planner keyword" },
      { stdin: "produce an implementation plan", expectedStage: "planner", label: "implementation plan phrase" },
      { stdin: "time to remediate the review findings", expectedStage: "remediation", label: "remediat* keyword" },
      { stdin: "execute the approved plan now", expectedStage: "executor", label: "fallback -> executor" },
    ];

    for (const { stdin, expectedStage, label } of cases) {
      it(`routes "${label}" to stage "${expectedStage}"`, async () => {
        const handler = createMockProcessHandler();
        const result = await handler(baseOptions({ command: "claude", stdinData: stdin }));
        const payload = extractPayload(result.stdout);
        expect(payload.stage).toBe(expectedStage);
        expect(payload.success).toBe(true);
      });
    }

    it("matches a claude command via endsWith (absolute path binary)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/usr/local/bin/claude", stdinData: "you are the planner" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("is case-insensitive on stdin content", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude", stdinData: "PLANNER TASK" }));
      expect(extractPayload(result.stdout).stage).toBe("planner");
    });

    it("falls back to executor output when stdinData is absent", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "claude" }));
      expect(extractPayload(result.stdout).stage).toBe("executor");
    });
  });

  describe("codex-command branches (isCodex)", () => {
    it("routes plan-review phrasing to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "start the plan review" }));
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("routes 'plan-reviewer' keyword to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(baseOptions({ command: "codex", stdinData: "you are the plan-reviewer" }));
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("routes 'plan under review' phrasing to the plan-reviewer output", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "codex", stdinData: "the plan under review is attached" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("matches a codex command via endsWith (absolute path binary)", async () => {
      const handler = createMockProcessHandler();
      const result = await handler(
        baseOptions({ command: "/opt/bin/codex", stdinData: "plan review please" }),
      );
      expect(extractPayload(result.stdout).stage).toBe("plan-reviewer");
    });

    it("returns changes_requested on the first code-review call and approved on the second, per handler instance", async () => {
      const handler = createMockProcessHandler();
      const opts = baseOptions({ command: "codex", stdinData: "please review this diff" });

      const first = await handler(opts);
      const second = await handler(opts);
      const third = await handler(opts);

      const firstPayload = extractPayload(first.stdout) as { payload: { overallVerdict: string } };
      const secondPayload = extractPayload(second.stdout) as { payload: { overallVerdict: string } };
      const thirdPayload = extractPayload(third.stdout) as { payload: { overallVerdict: string } };

      expect(firstPayload.stage).toBe("reviewer");
      expect(firstPayload.payload.overallVerdict).toBe("changes_requested");
      expect(secondPayload.payload.overallVerdict).toBe("approved");
      // Verdict stays "approved" (not reset) on subsequent calls within the same handler.
      expect(thirdPayload.payload.overallVerdict).toBe("approved");
    });

    it("tracks the code-review call counter independently across separate handler instances", async () => {
      const handlerA = createMockProcessHandler();
      const handlerB = createMockProcessHandler();
      const opts = baseOptions({ command: "codex", stdinData: "please review this diff" });

      // Exhaust handlerA's first call so it would return "approved" next...
      await handlerA(opts);
      // ...but a fresh handlerB should independently start back at "changes_requested".
      const bFirst = await handlerB(opts);
      const bPayload = extractPayload(bFirst.stdout) as { payload: { overallVerdict: string } };
      expect(bPayload.payload.overallVerdict).toBe("changes_requested");
    });
  });

  it("returns a failure planner stub when the command is neither claude nor codex", async () => {
    const handler = createMockProcessHandler();
    const result = await handler(baseOptions({ command: "cursor", stdinData: "anything" }));
    const payload = extractPayload(result.stdout) as { success: boolean; stage: string; payload: unknown };
    expect(payload.success).toBe(false);
    expect(payload.stage).toBe("planner");
    expect(payload.payload).toEqual({});
  });
});
